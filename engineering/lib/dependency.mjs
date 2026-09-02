import { posix, win32 } from 'node:path';

const NPM_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const CRITICAL_NPM_DEPENDENCIES = new Set([
  'expo',
  'next',
  'react',
  'react-dom',
  'react-native',
  'typescript',
]);
const DEPENDENCY_FILE = /(^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties|libs\.versions\.toml)$/;
const LOCKFILE = /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|gradle\.lockfile)$/;
const GRADLE_FILE = /(^|\/)(?:build|settings)\.gradle(?:\.kts)?$/;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRepositoryRelativePath(path) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.length > 1024
    || path.includes('\0')
    || path.includes('\\')
    || posix.isAbsolute(path)
    || win32.isAbsolute(path)
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Path must be a repository-relative path: ${String(path)}`);
  }
  return path;
}

function finding(code, path, message, details = {}) {
  return { code, path, message, ...details };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(content, path, code, findings) {
  if (typeof content !== 'string') {
    findings.push(finding(code, path, 'Dependency input content must be a string.'));
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    if (!isObject(parsed)) {
      findings.push(finding(code, path, 'Dependency input must contain a JSON object.'));
      return null;
    }
    return parsed;
  } catch (error) {
    findings.push(finding(code, path, `Dependency input is not valid JSON: ${error.message}`));
    return null;
  }
}

function dependencyRecords(document, path, findings, invalidCode = 'INVALID_MANIFEST') {
  const records = [];
  for (const section of NPM_SECTIONS) {
    if (document[section] === undefined) continue;
    if (!isObject(document[section])) {
      findings.push(finding(invalidCode, path, `${section} must be a JSON object.`));
      continue;
    }
    for (const dependency of Object.keys(document[section]).sort(compareText)) {
      const version = document[section][dependency];
      if (typeof version !== 'string' || version.trim().length === 0) {
        findings.push(finding(invalidCode, path, `${section}.${dependency} must be a non-empty version string.`, { dependency, section }));
        continue;
      }
      records.push({ dependency, version: version.trim(), section, path });
    }
  }
  return records;
}

function isUnboundedNpmVersion(version) {
  const normalized = version.trim();
  if (/^(?:\*|x|latest)$/i.test(normalized)) return true;
  if (/(?:^|\|\||\s)\*(?:$|\s)/.test(normalized)) return true;
  if (/^(?:>|>=)\s*v?\d/.test(normalized)) return !/(?:<|<=)\s*v?\d/.test(normalized);
  return false;
}

function npmManifestDirectory(path) {
  return posix.dirname(path) === '.' ? '' : posix.dirname(path);
}

function combinedDependencyMap(records) {
  const result = new Map();
  for (const record of records) {
    if (!result.has(record.dependency)) result.set(record.dependency, record.version);
  }
  return result;
}

function packageLockRootRecords(document) {
  const root = isObject(document.packages?.['']) ? document.packages[''] : null;
  if (!root) return { records: [], declarations: false };
  const records = [];
  for (const section of NPM_SECTIONS) {
    if (!isObject(root[section])) continue;
    for (const dependency of Object.keys(root[section]).sort(compareText)) {
      if (typeof root[section][dependency] === 'string') {
        records.push({ dependency, version: root[section][dependency].trim(), section });
      }
    }
  }
  return { records, declarations: true };
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function resolvedVersionSatisfies(specifier, resolved) {
  const actual = parseSemver(resolved);
  if (!actual) return null;
  const value = specifier.trim();
  const exact = parseSemver(value);
  if (exact) return compareSemver(actual, exact) === 0;

  let match = /^[~^]\s*v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(value);
  if (match) {
    const lower = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
    if (compareSemver(actual, lower) < 0) return false;
    if (value.startsWith('~')) return actual[0] === lower[0] && actual[1] === lower[1];
    if (lower[0] > 0) return actual[0] === lower[0];
    if (lower[1] > 0) return actual[0] === 0 && actual[1] === lower[1];
    return actual[0] === 0 && actual[1] === 0 && actual[2] === lower[2];
  }

  match = /^v?(\d+)(?:\.(\d+))?(?:\.(?:x|X|\*))?$/.exec(value);
  if (match) {
    if (actual[0] !== Number(match[1])) return false;
    return match[2] === undefined || actual[1] === Number(match[2]);
  }
  return null;
}

function oldPackageLockRecords(document) {
  const records = [];
  if (!isObject(document.dependencies)) return records;
  for (const dependency of Object.keys(document.dependencies).sort(compareText)) {
    const entry = document.dependencies[dependency];
    if (isObject(entry) && typeof entry.version === 'string') {
      records.push({ dependency, version: entry.version.trim(), section: 'dependencies' });
    }
  }
  return records;
}

function npmPackageNameFromInstallPath(installPath) {
  const marker = 'node_modules/';
  const markerIndex = installPath.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  const remainder = installPath.slice(markerIndex + marker.length);
  const segments = remainder.split('/');
  return segments[0]?.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function criticalVersionsFromLock(document) {
  const versions = new Map();
  if (isObject(document.packages)) {
    for (const installPath of Object.keys(document.packages).sort(compareText)) {
      const name = npmPackageNameFromInstallPath(installPath);
      const version = document.packages[installPath]?.version;
      if (name && CRITICAL_NPM_DEPENDENCIES.has(name) && typeof version === 'string') {
        if (!versions.has(name)) versions.set(name, new Set());
        versions.get(name).add(version);
      }
    }
  }

  const visit = (dependencies, seen = new Set()) => {
    if (!isObject(dependencies) || seen.has(dependencies)) return;
    seen.add(dependencies);
    for (const name of Object.keys(dependencies).sort(compareText)) {
      const entry = dependencies[name];
      if (!isObject(entry)) continue;
      if (CRITICAL_NPM_DEPENDENCIES.has(name) && typeof entry.version === 'string') {
        if (!versions.has(name)) versions.set(name, new Set());
        versions.get(name).add(entry.version);
      }
      visit(entry.dependencies, seen);
    }
  };
  visit(document.dependencies);
  return versions;
}

function stripGradleComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function gradleCoordinates(content, path) {
  const coordinates = [];
  const expression = /["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^"'\s]+)["']/g;
  for (const match of stripGradleComments(content).matchAll(expression)) {
    coordinates.push({
      dependency: `${match[1]}:${match[2]}`,
      version: match[3],
      coordinate: match[0].slice(1, -1),
      path,
    });
  }
  return coordinates;
}

function isUnboundedGradleVersion(version) {
  return version === '+' || /(?:^|\.)\+$/.test(version) || /^(?:latest\.(?:release|integration)|release|integration)$/i.test(version);
}

function sortFindings(findings) {
  return findings.sort((left, right) => {
    for (const key of ['code', 'path', 'dependency', 'section', 'message']) {
      const compared = compareText(String(left[key] ?? ''), String(right[key] ?? ''));
      if (compared !== 0) return compared;
    }
    return compareText(JSON.stringify(left), JSON.stringify(right));
  });
}

function deduplicateFindings(findings) {
  const unique = new Map();
  for (const item of findings) {
    const key = JSON.stringify(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

export function analyzeDependencyState({
  manifests = [],
  lockfiles = [],
  gradleFiles = [],
  changes = [],
  manifestDiffs = [],
} = {}) {
  for (const [name, value] of Object.entries({ manifests, lockfiles, gradleFiles, changes, manifestDiffs })) {
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  }

  const findings = [];
  const manifestsByDirectory = new Map();
  const npmRecords = [];

  for (const manifest of [...manifests].sort((left, right) => compareText(String(left?.path), String(right?.path)))) {
    const path = assertRepositoryRelativePath(manifest?.path);
    const document = parseJson(manifest?.content, path, 'INVALID_MANIFEST', findings);
    if (!document) continue;
    const records = dependencyRecords(document, path, findings);
    npmRecords.push(...records);
    manifestsByDirectory.set(npmManifestDirectory(path), { path, records });

    const sectionsByDependency = new Map();
    for (const record of records) {
      if (!sectionsByDependency.has(record.dependency)) sectionsByDependency.set(record.dependency, []);
      sectionsByDependency.get(record.dependency).push(record);
      if (isUnboundedNpmVersion(record.version)) {
        findings.push(finding('UNBOUNDED_VERSION', path, `${record.dependency} uses the unbounded npm version ${record.version}.`, {
          dependency: record.dependency,
          version: record.version,
          section: record.section,
        }));
      }
    }
    for (const [dependency, duplicateRecords] of sectionsByDependency) {
      if (duplicateRecords.length < 2) continue;
      findings.push(finding('DUPLICATE_NPM_DEPENDENCY', path, `${dependency} is declared in multiple dependency sections.`, {
        dependency,
        sections: duplicateRecords.map(({ section }) => section).sort(compareText),
      }));
    }
  }

  const npmVersions = new Map();
  for (const record of npmRecords) {
    if (!npmVersions.has(record.dependency)) npmVersions.set(record.dependency, []);
    npmVersions.get(record.dependency).push(record);
  }
  for (const dependency of [...npmVersions.keys()].sort(compareText)) {
    const records = npmVersions.get(dependency);
    const versions = [...new Set(records.map(({ version }) => version))].sort(compareText);
    if (versions.length < 2) continue;
    const paths = [...new Set(records.map(({ path }) => path))].sort(compareText);
    findings.push(finding('VERSION_INCONSISTENCY', paths[0], `${dependency} has inconsistent npm version declarations: ${versions.join(', ')}.`, {
      dependency,
      versions,
      paths,
    }));
  }

  for (const lockfile of [...lockfiles].sort((left, right) => compareText(String(left?.path), String(right?.path)))) {
    const path = assertRepositoryRelativePath(lockfile?.path);
    if (!/(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json)$/.test(path)) continue;
    const document = parseJson(lockfile?.content, path, 'INVALID_LOCKFILE', findings);
    if (!document) continue;
    const directory = npmManifestDirectory(path);
    const manifest = manifestsByDirectory.get(directory);
    const root = packageLockRootRecords(document);
    const lockRecords = root.declarations ? root.records : oldPackageLockRecords(document);
    if (manifest) {
      const manifestMap = combinedDependencyMap(manifest.records);
      const lockMap = new Map(lockRecords.map(({ dependency, version }) => [dependency, version]));
      for (const dependency of [...new Set([...manifestMap.keys(), ...lockMap.keys()])].sort(compareText)) {
        const manifestVersion = manifestMap.get(dependency);
        const lockVersion = lockMap.get(dependency);
        let agrees = manifestVersion !== undefined && lockVersion !== undefined;
        if (agrees && root.declarations) agrees = manifestVersion === lockVersion;
        else if (agrees) agrees = resolvedVersionSatisfies(manifestVersion, lockVersion) !== false;
        if (agrees) continue;
        findings.push(finding('LOCKFILE_MANIFEST_DISAGREEMENT', path, `${dependency} differs between ${manifest.path} and ${path}.`, {
          dependency,
          manifest_path: manifest.path,
          manifest_version: manifestVersion ?? null,
          lockfile_version: lockVersion ?? null,
        }));
      }
    }

    for (const [dependency, versionSet] of criticalVersionsFromLock(document)) {
      const versions = [...versionSet].sort(compareText);
      if (versions.length < 2) continue;
      findings.push(finding('MULTIPLE_CRITICAL_VERSIONS', path, `${dependency} resolves to multiple versions: ${versions.join(', ')}.`, {
        dependency,
        versions,
      }));
    }
  }

  const allGradleCoordinates = [];
  for (const gradleFile of [...gradleFiles].sort((left, right) => compareText(String(left?.path), String(right?.path)))) {
    const path = assertRepositoryRelativePath(gradleFile?.path);
    if (typeof gradleFile?.content !== 'string') {
      findings.push(finding('INVALID_GRADLE_FILE', path, 'Gradle file content must be a string.'));
      continue;
    }
    const coordinates = gradleCoordinates(gradleFile.content, path);
    allGradleCoordinates.push(...coordinates);
    const occurrences = new Map();
    for (const coordinate of coordinates) {
      const key = coordinate.coordinate;
      if (!occurrences.has(key)) occurrences.set(key, []);
      occurrences.get(key).push(coordinate);
      if (isUnboundedGradleVersion(coordinate.version)) {
        findings.push(finding('UNBOUNDED_VERSION', path, `${coordinate.dependency} uses the unbounded Gradle version ${coordinate.version}.`, {
          dependency: coordinate.dependency,
          version: coordinate.version,
        }));
      }
    }
    for (const [coordinate, duplicateRecords] of occurrences) {
      if (duplicateRecords.length < 2) continue;
      findings.push(finding('DUPLICATE_GRADLE_DEPENDENCY', path, `${coordinate} is declared ${duplicateRecords.length} times.`, {
        dependency: duplicateRecords[0].dependency,
        coordinate,
        occurrences: duplicateRecords.length,
      }));
    }
  }

  const gradleVersions = new Map();
  for (const record of allGradleCoordinates) {
    if (!gradleVersions.has(record.dependency)) gradleVersions.set(record.dependency, []);
    gradleVersions.get(record.dependency).push(record);
  }
  for (const dependency of [...gradleVersions.keys()].sort(compareText)) {
    const records = gradleVersions.get(dependency);
    const versions = [...new Set(records.map(({ version }) => version))].sort(compareText);
    if (versions.length < 2) continue;
    const paths = [...new Set(records.map(({ path }) => path))].sort(compareText);
    findings.push(finding('VERSION_INCONSISTENCY', paths[0], `${dependency} has inconsistent Gradle version declarations: ${versions.join(', ')}.`, {
      dependency,
      versions,
      paths,
    }));
  }

  for (const change of [...changes].sort((left, right) => compareText(String(left?.path), String(right?.path)))) {
    const path = assertRepositoryRelativePath(change?.path);
    if (!DEPENDENCY_FILE.test(path)) continue;
    const additions = Number(change?.additions ?? 0);
    const deletions = Number(change?.deletions ?? 0);
    const churn = (Number.isFinite(additions) ? Math.max(0, additions) : 0) + (Number.isFinite(deletions) ? Math.max(0, deletions) : 0);
    const threshold = LOCKFILE.test(path) ? 500 : GRADLE_FILE.test(path) ? 50 : 50;
    if (churn < threshold) continue;
    findings.push(finding('SUSPICIOUS_DEPENDENCY_CHURN', path, `Dependency file changed by ${churn} lines, above the ${threshold}-line review threshold.`, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      churn,
      threshold,
    }));
  }

  for (const manifestDiff of [...manifestDiffs].sort((left, right) => compareText(String(left?.path), String(right?.path)))) {
    const path = assertRepositoryRelativePath(manifestDiff?.path);
    const before = parseJson(manifestDiff?.before, path, 'INVALID_MANIFEST_DIFF', findings);
    const after = parseJson(manifestDiff?.after, path, 'INVALID_MANIFEST_DIFF', findings);
    if (!before || !after) continue;
    const beforeRecords = dependencyRecords(before, path, findings, 'INVALID_MANIFEST_DIFF');
    const afterRecords = dependencyRecords(after, path, findings, 'INVALID_MANIFEST_DIFF');
    const beforeNames = new Set(beforeRecords.map(({ dependency }) => dependency));
    for (const record of afterRecords) {
      if (beforeNames.has(record.dependency)) continue;
      findings.push(finding('DEPENDENCY_ADDED', path, `${record.dependency} was added to ${record.section}.`, {
        dependency: record.dependency,
        version: record.version,
        section: record.section,
      }));
    }
  }

  const sorted = sortFindings(deduplicateFindings(findings));
  const invalid = sorted.some(({ code }) => code.startsWith('INVALID_'));
  const status = invalid ? 'FAIL' : sorted.length > 0 ? 'WARN' : 'PASS';
  return {
    status,
    summary: sorted.length === 0 ? 'No deterministic dependency issues detected.' : `${sorted.length} dependency finding(s) require review.`,
    next_actions: sorted.length === 0 ? [] : ['Review dependency findings; update manifests or lockfiles deliberately and regenerate locks when needed.'],
    artifacts: [],
    findings: sorted,
  };
}
