import { execFileSync } from 'node:child_process';

import { isSafeRepositoryPath, matchesPattern, validateSprintContract } from './contract.mjs';

const MANIFEST = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties)$/;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|gradle\.lockfile)$/;
const MIGRATION = /(^|\/)db\/migration\/.*\.sql$/i;
const TEST_FILE = /(^|\/)(?:__tests__\/.*|.*(?:\.test|\.spec)\.[^.]+)$/;
const GENERATED = /(^|\/)(generated|dist|build)\/|\.generated\./i;

function finding(code, path, message) {
  return { code, path, message };
}

function pathJustified(path, justifications = {}) {
  return Object.keys(justifications).some((pattern) => matchesPattern(path, pattern));
}

function normalizedPatchSides(patch = '') {
  const added = [];
  const removed = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added.push(line.slice(1).replace(/\s+/g, ' ').trim());
    if (line.startsWith('-')) removed.push(line.slice(1).replace(/\s+/g, ' ').trim());
  }
  return { added, removed };
}

export function isFormattingOnlyChange(patch) {
  const { added, removed } = normalizedPatchSides(patch);
  return added.length > 0 && removed.length > 0 && added.join('\n') === removed.join('\n');
}

function signalsFor(change) {
  const signals = [];
  const path = change.path;
  if (MANIFEST.test(path)) signals.push(finding('DEPENDENCY_MANIFEST_CHANGED', path, 'Dependency manifest or build definition changed.'));
  if (MIGRATION.test(path)) signals.push(finding('DATABASE_MIGRATION_CHANGED', path, 'Database migration changed.'));
  if (path.startsWith('.github/workflows/')) signals.push(finding('CI_CONFIG_CHANGED', path, 'CI workflow changed.'));
  if (/(^|\/)(auth|security)(\/|\.|-)|Security|Auth/.test(path)) signals.push(finding('AUTH_SECURITY_CHANGED', path, 'Authentication or security-sensitive code changed.'));
  if (path.startsWith('contracts/') || /Controllers?\.(kt|java)$/.test(path)) signals.push(finding('PUBLIC_CONTRACT_CHANGED', path, 'Public API or contract surface changed.'));
  if (GENERATED.test(path)) signals.push(finding('GENERATED_FILE_CHANGED', path, 'Generated or build-output path changed.'));
  if (LOCKFILE.test(path) && Number(change.additions ?? 0) + Number(change.deletions ?? 0) >= 500) {
    signals.push(finding('LOCKFILE_CHURN', path, 'Lockfile has unusually large churn.'));
  }
  if (change.status === 'D' && TEST_FILE.test(path)) signals.push(finding('TEST_DELETED', path, 'A test file was deleted.'));
  if (/(^|\/)(\.env[^/]*|app\.json|eas\.json|tsconfig\.json)$/.test(path)) {
    signals.push(finding('ENVIRONMENT_CONFIG_CHANGED', path, 'Environment or runtime configuration changed.'));
  }
  return signals;
}

export function evaluateScope({ contract, changes }) {
  const validation = validateSprintContract(contract);
  if (!validation.valid) {
    return {
      status: 'FAIL',
      summary: 'Scope analysis stopped because the sprint contract is invalid.',
      next_actions: ['Repair the sprint contract before evaluating the diff.'],
      artifacts: [],
      files: [],
      warnings: [],
      scope_creep: validation.errors.map((message) => finding('INVALID_CONTRACT', null, message)),
      justification_required: [],
    };
  }

  const files = [];
  const warnings = [];
  const scopeCreep = [];
  const justificationRequired = [];

  for (const change of changes) {
    const path = change.path;
    if (!isSafeRepositoryPath(path)) {
      const unsafe = finding('UNSAFE_CHANGED_PATH', path, 'Git reported a path that is not safe and repository-relative.');
      scopeCreep.push(unsafe);
      files.push({ path, status: change.status, classification: 'LIKELY_SCOPE_CREEP', signals: [unsafe.code] });
      continue;
    }

    const allowed = contract.scope.allowed_paths.some((pattern) => matchesPattern(path, pattern));
    const forbidden = contract.scope.forbidden_paths.some((pattern) => matchesPattern(path, pattern));
    const signals = signalsFor(change);
    warnings.push(...signals);

    if (!allowed) scopeCreep.push(finding('OUTSIDE_ALLOWED_PATHS', path, 'Changed file is outside declared sprint paths.'));
    if (forbidden) scopeCreep.push(finding('FORBIDDEN_PATH_CHANGED', path, 'Changed file matches an explicit forbidden path.'));
    if (MIGRATION.test(path) && !allowed) {
      scopeCreep.push(finding('DATABASE_MIGRATION_OUT_OF_SCOPE', path, 'Migration changed outside declared sprint scope.'));
    }
    if (!allowed && isFormattingOnlyChange(change.patch)) {
      scopeCreep.push(finding('FORMATTING_ONLY_OUTSIDE_SCOPE', path, 'Formatting-only edit is outside declared sprint scope.'));
    }

    const sensitive = signals.length > 0;
    if (allowed && sensitive && !pathJustified(path, contract.scope.justifications)) {
      justificationRequired.push(
        finding('SENSITIVE_CHANGE_REQUIRES_JUSTIFICATION', path, `Sensitive signals require a declared justification: ${signals.map(({ code }) => code).join(', ')}`),
      );
    }

    const fileCreep = scopeCreep.some((item) => item.path === path);
    const fileNeedsJustification = justificationRequired.some((item) => item.path === path);
    files.push({
      path,
      status: change.status,
      additions: Number(change.additions ?? 0),
      deletions: Number(change.deletions ?? 0),
      classification: fileCreep ? 'LIKELY_SCOPE_CREEP' : fileNeedsJustification ? 'JUSTIFICATION_REQUIRED' : 'IN_SCOPE',
      signals: signals.map(({ code }) => code),
    });
  }

  const status = scopeCreep.length > 0 ? 'FAIL' : justificationRequired.length > 0 ? 'WARN' : 'PASS';
  return {
    status,
    summary: `${files.length} changed file(s): ${scopeCreep.length} scope-creep finding(s), ${justificationRequired.length} justification request(s).`,
    next_actions: status === 'PASS' ? [] : ['Repair out-of-scope changes or record explicit path-level justifications.'],
    artifacts: [],
    files,
    warnings,
    scope_creep: scopeCreep,
    justification_required: justificationRequired,
  };
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30_000,
  });
}

export function collectGitChanges({ repoRoot, base, head = 'HEAD' }) {
  if (!/^[0-9A-Za-z_./^-]+$/.test(base) || !/^[0-9A-Za-z_./^-]+$/.test(head)) {
    throw new Error('Git revisions contain unsupported characters.');
  }
  const range = `${base}..${head}`;
  const statusOutput = git(repoRoot, ['diff', '--name-status', '--no-renames', '-z', range, '--']);
  const numberOutput = git(repoRoot, ['diff', '--numstat', '--no-renames', '-z', range, '--']);
  const numberByPath = new Map();
  for (const record of numberOutput.split('\0').filter(Boolean)) {
    const [additions, deletions, path] = record.split('\t');
    if (path) numberByPath.set(path, { additions: additions === '-' ? 0 : Number(additions), deletions: deletions === '-' ? 0 : Number(deletions) });
  }
  const tokens = statusOutput.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const status = tokens[index];
    const path = tokens[index + 1];
    if (!path) continue;
    const stats = numberByPath.get(path) ?? { additions: 0, deletions: 0 };
    const patch = git(repoRoot, ['diff', '--no-ext-diff', '--unified=0', '--no-renames', range, '--', path]);
    changes.push({ path, status: status[0], ...stats, patch });
  }
  return changes;
}
