import { execFileSync } from 'node:child_process';

import { analyzeDependencyState } from './dependency.mjs';
import { collectGitChanges } from './scope.mjs';

const MANIFEST = /(^|\/)package\.json$/;
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json)$/;
const GRADLE = /(^|\/)(build|settings)\.gradle(\.kts)?$/;

export function git(repoRoot, args, { allowedExitCodes = [] } = {}) {
  try {
    return execFileSync('git', ['--no-pager', '--literal-pathspecs', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    if (allowedExitCodes.includes(error.status)) return null;
    const detail = typeof error.stderr === 'string' ? error.stderr.trim().split('\n')[0] : error.message;
    throw new Error(`Git command failed: ${detail}`, { cause: error });
  }
}

export function resolveRevision(repoRoot, revision = 'HEAD') {
  if (typeof revision !== 'string' || !/^[0-9A-Za-z_./^-]{1,240}$/.test(revision)) throw new Error('Git revision contains unsupported characters.');
  const resolved = git(repoRoot, ['rev-parse', '--verify', `${revision}^{commit}`]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(resolved)) throw new Error('Git did not resolve a full commit SHA.');
  return resolved;
}

export function assertAncestor(repoRoot, baseSha, headSha) {
  const result = git(repoRoot, ['merge-base', '--is-ancestor', baseSha, headSha], { allowedExitCodes: [1] });
  if (result === null) throw new Error('Sprint base commit must be an ancestor of the certification head.');
}

export function repositoryRoot(cwd = process.cwd()) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

export function workingTreePaths(repoRoot) {
  const records = git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('Git returned an unsupported porcelain status record.');
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes('R') || status.includes('C')) {
      const sourcePath = records[index + 1];
      if (!sourcePath) throw new Error('Git returned an incomplete rename/copy status record.');
      paths.push(sourcePath);
      index += 1;
    }
  }
  return [...new Set(paths)].sort();
}

function trackedPathsAt(repoRoot, revision) {
  return git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', revision, '--']).split('\0').filter(Boolean).sort();
}

function contentAt(repoRoot, revision, path) {
  const object = `${revision}:${path}`;
  const tracked = git(repoRoot, ['ls-tree', '--name-only', '-z', revision, '--', path]).split('\0').filter(Boolean);
  return tracked.includes(path) ? git(repoRoot, ['show', object]) : null;
}

function dependencyInputsAt(repoRoot, revision) {
  const manifests = [];
  const lockfiles = [];
  const gradleFiles = [];
  for (const path of trackedPathsAt(repoRoot, revision)) {
    if (!MANIFEST.test(path) && !LOCKFILE.test(path) && !GRADLE.test(path)) continue;
    const content = contentAt(repoRoot, revision, path);
    if (content === null) continue;
    if (MANIFEST.test(path)) manifests.push({ path, content });
    else if (LOCKFILE.test(path)) lockfiles.push({ path, content });
    else if (GRADLE.test(path)) gradleFiles.push({ path, content });
  }
  return { manifests, lockfiles, gradleFiles };
}

function fingerprintFinding(finding) {
  const clone = { ...finding };
  delete clone.baseline;
  return JSON.stringify(clone);
}

export function analyzeRepositoryDependencies({ repoRoot, base, head = 'HEAD' }) {
  const baseSha = resolveRevision(repoRoot, base);
  const headSha = resolveRevision(repoRoot, head);
  assertAncestor(repoRoot, baseSha, headSha);
  const changes = collectGitChanges({ repoRoot, base: baseSha, head: headSha });
  const baseInputs = dependencyInputsAt(repoRoot, baseSha);
  const headInputs = dependencyInputsAt(repoRoot, headSha);
  const manifestDiffs = [];
  const manifestPaths = new Set([...baseInputs.manifests.map(({ path }) => path), ...headInputs.manifests.map(({ path }) => path)]);
  for (const path of [...manifestPaths].sort()) {
    const before = contentAt(repoRoot, baseSha, path);
    const after = contentAt(repoRoot, headSha, path);
    if (before !== after) {
      manifestDiffs.push({
        path,
        before: before ?? '{}',
        after: after ?? '{}',
        change_kind: before === null ? 'added' : after === null ? 'deleted' : 'modified',
      });
    }
  }

  const baselineReport = analyzeDependencyState({ ...baseInputs });
  const report = analyzeDependencyState({ ...headInputs, changes, manifestDiffs });
  const baselineFingerprints = new Set(baselineReport.findings.map(fingerprintFinding));
  const findings = report.findings.map((item) => ({ ...item, baseline: baselineFingerprints.has(fingerprintFinding(item)) }));
  const introduced = findings.filter(({ baseline }) => !baseline);
  const invalid = introduced.some(({ code }) => code.startsWith('INVALID_'));
  return {
    ...report,
    schema_version: 1,
    report_type: 'dependency',
    status: invalid ? 'FAIL' : introduced.length > 0 ? 'WARN' : 'PASS',
    summary: `${findings.length} total dependency finding(s); ${introduced.length} introduced by ${baseSha.slice(0, 12)}...${headSha.slice(0, 12)}.`,
    base_sha: baseSha,
    head_sha: headSha,
    findings,
    baseline_finding_count: findings.length - introduced.length,
    introduced_finding_count: introduced.length,
  };
}
