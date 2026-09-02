import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isSafeRepositoryPath } from './contract.mjs';

const catalogDocument = JSON.parse(readFileSync(new URL('../policies/check-catalog.json', import.meta.url), 'utf8'));
const CHECK_CATALOG = catalogDocument.checks.map(({ argv, ...check }) => ({ ...check, command: argv }));

const ALLOWED_EXECUTABLES = new Set(['bash', 'npm', 'node', './gradlew']);
const SAFE_CHECK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateCheckCatalog(catalog = CHECK_CATALOG) {
  const ids = new Set();
  for (const check of catalog) {
    if (!check || typeof check !== 'object' || !SAFE_CHECK_ID.test(check.id ?? '')) throw new Error('Check catalog entry has an invalid id.');
    if (ids.has(check.id)) throw new Error(`Duplicate check id: ${check.id}`);
    ids.add(check.id);
    if (!Array.isArray(check.command) || check.command.length === 0 || check.command.some((argument) => typeof argument !== 'string')) {
      throw new Error(`Check ${check.id} command must be a non-empty argument array.`);
    }
    if (!ALLOWED_EXECUTABLES.has(check.command[0])) throw new Error(`Check ${check.id} executable is not allowlisted.`);
    if (check.cwd !== '.' && !isSafeRepositoryPath(check.cwd)) throw new Error(`Check ${check.id} has an unsafe working directory.`);
    if (!Number.isInteger(check.timeout_ms) || check.timeout_ms < 1 || check.timeout_ms > 3_600_000) {
      throw new Error(`Check ${check.id} timeout must be between 1 and 3600000 milliseconds.`);
    }
    if (!['BUILD', 'TESTS', 'TYPECHECK', 'LINT', 'CONTRACTS', 'SECURITY'].includes(check.category ?? 'TESTS')) {
      throw new Error(`Check ${check.id} category is invalid.`);
    }
  }
  return true;
}

function selectedIds(changedPaths) {
  const ids = new Set();
  const hasContract = changedPaths.some((path) => path.startsWith('contracts/'));
  if (hasContract) {
    for (const id of ['backend_verify', 'customer_typecheck', 'customer_tests', 'merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests', 'captain_typecheck', 'captain_tests']) ids.add(id);
  }
  for (const path of changedPaths) {
    if (path.startsWith('backend/') || path === 'build.gradle.kts' || path === 'settings.gradle.kts' || (path.startsWith('scripts/') && path !== 'scripts/verify-engineering-toolkit.sh')) ids.add('backend_verify');
    if (path.includes('/db/migration/')) ids.add('migration_contract');
    if (path.startsWith('apps/customer-app/')) for (const id of ['customer_typecheck', 'customer_lint', 'customer_tests']) ids.add(id);
    if (path.startsWith('apps/merchant-app/')) for (const id of ['merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests']) ids.add(id);
    if (path.startsWith('apps/captain-app/')) for (const id of ['captain_typecheck', 'captain_lint', 'captain_tests', 'captain_architecture']) ids.add(id);
    if (path.startsWith('engineering/') || path === 'scripts/verify-engineering-toolkit.sh') {
      ids.add('security_scan');
      ids.add('engineering_evals');
    }
  }
  return ids;
}

export function selectChecks(changedPaths, catalog = CHECK_CATALOG) {
  validateCheckCatalog(catalog);
  for (const path of changedPaths) {
    if (!isSafeRepositoryPath(path)) throw new Error(`Changed path is not safe and repository-relative: ${path}`);
  }
  const ids = selectedIds(changedPaths);
  return catalog.filter(({ id }) => ids.has(id));
}

function minimalEnvironment(overrides = {}) {
  const allowed = ['PATH', 'HOME', 'JAVA_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'CI', 'TERM', 'GRADLE_USER_HOME'];
  const env = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...overrides };
}

function redactOutput(output) {
  return output
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\bgh[opusr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
}

export function runChecks({ repoRoot, checks, outputDirectory, headSha, env = {} }) {
  validateCheckCatalog(checks);
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('headSha must be a full lowercase Git SHA.');
  const resolvedRoot = realpathSync(resolve(repoRoot));
  const resolvedOutput = resolve(resolvedRoot, outputDirectory);
  if (!(resolvedOutput === resolvedRoot || resolvedOutput.startsWith(`${resolvedRoot}/`))) throw new Error('Output directory must be inside the repository.');
  mkdirSync(resolvedOutput, { recursive: true });
  const results = [];
  for (const check of checks) {
    const started = performance.now();
    const workingDirectory = realpathSync(join(resolvedRoot, check.cwd));
    if (!(workingDirectory === resolvedRoot || workingDirectory.startsWith(`${resolvedRoot}/`))) {
      throw new Error(`Check ${check.id} working directory escapes the repository.`);
    }
    const result = spawnSync(check.command[0], check.command.slice(1), {
      cwd: workingDirectory,
      encoding: 'utf8',
      env: minimalEnvironment(env),
      shell: false,
      timeout: check.timeout_ms,
      killSignal: 'SIGTERM',
      maxBuffer: 50 * 1024 * 1024,
    });
    const durationMs = Math.round(performance.now() - started);
    const outputFile = join(outputDirectory, `${check.id}.log`);
    const combined = redactOutput([result.stdout ?? '', result.stderr ?? '', result.error ? `${result.error.name}: ${result.error.message}\n` : ''].join(''));
    writeFileSync(join(resolvedRoot, outputFile), combined, { mode: 0o600 });
    const outputSha256 = createHash('sha256').update(combined).digest('hex');
    const timedOut = result.error?.code === 'ETIMEDOUT';
    results.push({
      id: check.id,
      category: check.category,
      status: result.status === 0 && !timedOut ? 'PASS' : 'FAIL',
      exit_code: result.status ?? 1,
      duration_ms: durationMs,
      output_file: outputFile,
      output_sha256: outputSha256,
      head_sha: headSha,
      timed_out: timedOut,
    });
  }
  return results;
}

function hasEvidence(result) {
  return Number.isInteger(result?.exit_code)
    && Number.isFinite(result?.duration_ms)
    && result.duration_ms >= 0
    && typeof result.output_file === 'string'
    && result.output_file.length > 0
    && /^[0-9a-f]{64}$/.test(result.output_sha256 ?? '');
}

export function certify({
  startingSha,
  currentSha,
  changedFiles,
  requiredCheckIds,
  checkResults,
  scopeReport,
  dependencyReport,
  securityReport,
}) {
  const blockers = [];
  const resultsById = new Map(checkResults.map((result) => [result.id, result]));
  for (const id of requiredCheckIds) {
    const result = resultsById.get(id);
    if (!result) blockers.push({ code: 'REQUIRED_CHECK_MISSING', check_id: id, message: 'Required check was not executed.' });
    else if (!hasEvidence(result)) blockers.push({ code: 'MISSING_EXECUTION_EVIDENCE', check_id: id, message: 'Check result lacks exit code, duration, or output artifact.' });
    else if (result.head_sha !== currentSha) blockers.push({ code: 'STALE_HEAD_EVIDENCE', check_id: id, message: 'Check evidence was captured for a different Git head.' });
    else if (result.status !== 'PASS' || result.exit_code !== 0) blockers.push({ code: 'REQUIRED_CHECK_FAILED', check_id: id, message: 'Required check did not pass.' });
  }
  for (const [name, report] of [['SCOPE', scopeReport], ['DEPENDENCIES', dependencyReport], ['SECURITY', securityReport]]) {
    if (report?.status !== 'PASS') blockers.push({ code: `${name}_NOT_PASSING`, message: `${name} report is ${report?.status ?? 'MISSING'}.` });
  }
  const grouped = {};
  for (const result of checkResults) (grouped[result.category ?? 'TESTS'] ??= []).push(result);
  const final = blockers.length === 0 ? 'CERTIFIED' : 'NOT_CERTIFIED';
  return {
    status: final === 'CERTIFIED' ? 'success' : 'error',
    summary: final === 'CERTIFIED' ? 'All required evidence passed.' : `Certification blocked by ${blockers.length} finding(s).`,
    next_actions: final === 'CERTIFIED' ? [] : ['Repair blockers and rerun every affected required check.'],
    artifacts: checkResults.map(({ output_file }) => output_file).filter(Boolean),
    starting_sha: startingSha,
    current_sha: currentSha,
    changed_files: changedFiles,
    checks: grouped,
    scope: scopeReport,
    dependencies: dependencyReport,
    security: securityReport,
    blockers,
    final,
  };
}

export { CHECK_CATALOG };
