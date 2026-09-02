import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';

import { isSafeRepositoryPath } from './contract.mjs';

const catalogDocument = JSON.parse(readFileSync(new URL('../policies/check-catalog.json', import.meta.url), 'utf8'));
const CHECK_CATALOG = Object.freeze(catalogDocument.checks.map(({ argv, ...check }) => Object.freeze({
  ...check,
  command: Object.freeze([...argv]),
})));

const ALLOWED_EXECUTABLES = new Set(['bash', 'npm', 'node', './gradlew']);
const SAFE_CHECK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EXECUTED_RESULTS = new WeakMap();

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
    if ((check.command[0] === 'node' && check.command[1] === '-e') || (check.command[0] === 'bash' && check.command[1] === '-c')) {
      throw new Error(`Check ${check.id} may not contain inline interpreter code.`);
    }
    if (!Number.isInteger(check.timeout_ms) || check.timeout_ms < 1 || check.timeout_ms > 3_600_000) {
      throw new Error(`Check ${check.id} timeout must be between 1 and 3600000 milliseconds.`);
    }
    if (check.output_policy !== undefined && !['full', 'summary_only'].includes(check.output_policy)) {
      throw new Error(`Check ${check.id} output policy is invalid.`);
    }
    if (!['BUILD', 'TESTS', 'TYPECHECK', 'LINT', 'CONTRACTS', 'SECURITY'].includes(check.category ?? 'TESTS')) {
      throw new Error(`Check ${check.id} category is invalid.`);
    }
  }
  return true;
}

function selectedIds(changedPaths) {
  const ids = new Set();
  const hasPublicContract = changedPaths.some((path) => path.startsWith('contracts/') || /Controllers?\.(kt|java)$/.test(path));
  if (hasPublicContract) {
    for (const id of ['backend_verify', 'customer_typecheck', 'customer_tests', 'merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests', 'captain_typecheck', 'captain_tests']) ids.add(id);
  }
  for (const path of changedPaths) {
    if (path.startsWith('backend/') || path === 'build.gradle.kts' || path === 'settings.gradle.kts' || path === 'gradle.properties' || path.startsWith('gradle/wrapper/')) ids.add('backend_verify');
    if (path.includes('/db/migration/')) ids.add('migration_contract');
    if (path.startsWith('apps/customer-app/')) for (const id of ['customer_typecheck', 'customer_lint', 'customer_tests']) ids.add(id);
    if (path.startsWith('apps/merchant-app/')) for (const id of ['merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests']) ids.add(id);
    if (path.startsWith('apps/captain-app/')) for (const id of ['captain_typecheck', 'captain_lint', 'captain_tests', 'captain_architecture']) ids.add(id);
    if (path.startsWith('engineering/') || path === 'scripts/verify-engineering-toolkit.sh') {
      ids.add('security_scan');
      ids.add('engineering_evals');
    }
    if (path === 'scripts/secret-scan.sh' || path === 'scripts/privacy-security-scan.sh') ids.add('security_scan');
    if (path.startsWith('scripts/merchant-app/')) for (const id of ['merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests']) ids.add(id);
    if (path.startsWith('scripts/merchant-operations/') || (path.startsWith('scripts/') && !['scripts/verify-engineering-toolkit.sh', 'scripts/secret-scan.sh', 'scripts/privacy-security-scan.sh'].includes(path) && !path.startsWith('scripts/merchant-app/'))) ids.add('backend_verify');
    if (path.startsWith('.github/') || /(^|\/)(auth|security)(\/|\.|-)|Security|Auth/.test(path)) ids.add('security_scan');
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

function minimalEnvironment(isolatedHome) {
  const allowed = ['PATH', 'JAVA_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'CI', 'TERM'];
  const env = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return {
    ...env,
    HOME: isolatedHome,
    npm_config_cache: join(isolatedHome, 'npm-cache'),
    GRADLE_USER_HOME: join(isolatedHome, 'gradle-cache'),
  };
}

function redactOutput(output) {
  return output
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\bgh[opusr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
}

function trustedCheckFingerprint(check) {
  return JSON.stringify({
    id: check.id,
    category: check.category,
    cwd: check.cwd,
    command: check.command,
    timeout_ms: check.timeout_ms,
    output_policy: check.output_policy ?? 'full',
  });
}

const TRUSTED_CHECK_FINGERPRINTS = new Map(CHECK_CATALOG.map((check) => [check.id, trustedCheckFingerprint(check)]));

function assertTrustedChecks(checks) {
  for (const check of checks) {
    if (TRUSTED_CHECK_FINGERPRINTS.get(check.id) !== trustedCheckFingerprint(check)) throw new Error(`Check ${check.id} does not match the reviewed command catalog.`);
  }
}

function assertExactGitState(repoRoot, headSha) {
  const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim();
  if (actualHead !== headSha) throw new Error(`Repository HEAD ${actualHead} does not match requested evidence head ${headSha}.`);
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
  if (status.length > 0) throw new Error('Repository working tree must be clean before and after exact-head checks.');
  const ignoredSensitiveInputs = execFileSync('git', [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '-z',
    '--',
    ':(glob)**/.env*',
    ':(glob)**/.npmrc',
    ':(glob)**/.yarnrc*',
    ':(glob)**/local.properties',
    ':(glob)**/settings.xml',
  ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
  if (ignoredSensitiveInputs.length > 0) throw new Error('Ignored environment or credential configuration must be absent during exact-head checks.');
}

function safeWrite(path, content) {
  const directory = dirname(path);
  const temporaryPath = resolve(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(descriptor, content);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the original atomic-replace error.
    }
    throw error;
  }
}

function ensureSafeDirectory(root, targetDirectory) {
  const missingSegments = [];
  let cursor = targetDirectory;
  while (true) {
    try {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Evidence output parent must be a real directory, not a symlink.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error('Unable to find a safe evidence output ancestor.');
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
  let realCursor = realpathSync(cursor);
  let relationship = relative(root, realCursor);
  if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error('Evidence output directory resolves outside the repository.');
  for (const segment of missingSegments) {
    const next = resolve(realCursor, segment);
    mkdirSync(next, { mode: 0o700 });
    const metadata = lstatSync(next);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Evidence output directory creation was redirected.');
    realCursor = realpathSync(next);
    relationship = relative(root, realCursor);
    if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error('Evidence output directory resolves outside the repository.');
  }
  return realCursor;
}

function killProcessGroup(pid) {
  if (!Number.isInteger(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

function executeCheck(check, workingDirectory, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(check.command[0], check.command.slice(1), {
      cwd: workingDirectory,
      env: environment,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outputLimit = 50 * 1024 * 1024;
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let outputTruncated = false;
    let outputLimitExceeded = false;
    let timedOut = false;
    let terminationStarted = false;
    let closeResult = null;
    let forceCompleted = false;
    let forceTimer = null;
    let groupForceKilled = false;

    const forceKillGroup = () => {
      if (groupForceKilled) return;
      killProcessGroup(child.pid);
      groupForceKilled = true;
    };

    const parentSignals = process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGHUP', 'SIGINT', 'SIGTERM'];
    const signalHandlers = new Map();
    const onParentExit = () => {
      try {
        forceKillGroup();
      } catch {
        // The process is already exiting; there is no safe recovery path.
      }
    };
    const removeParentHandlers = () => {
      process.removeListener('exit', onParentExit);
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    };
    for (const signal of parentSignals) {
      const handler = () => {
        removeParentHandlers();
        try {
          forceKillGroup();
        } finally {
          process.kill(process.pid, signal);
        }
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    process.once('exit', onParentExit);

    const collect = (target) => (chunk) => {
      if (outputBytes >= outputLimit) {
        outputTruncated = true;
        outputLimitExceeded = true;
        terminate();
        return;
      }
      const remaining = outputLimit - outputBytes;
      target.push(chunk.subarray(0, remaining));
      outputBytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) {
        outputTruncated = true;
        outputLimitExceeded = true;
        terminate();
      }
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));

    const maybeFinish = () => {
      if (!closeResult || (terminationStarted && !forceCompleted)) return;
      resolvePromise({
        ...closeResult,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        outputTruncated,
        outputLimitExceeded,
        pid: child.pid,
      });
    };

    const terminate = ({ timeout = false } = {}) => {
      if (terminationStarted) return;
      terminationStarted = true;
      timedOut = timeout;
      if (process.platform === 'win32') {
        forceKillGroup();
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') rejectPromise(error);
        }
      }
      forceTimer = setTimeout(() => {
        try {
          forceKillGroup();
          forceCompleted = true;
          maybeFinish();
        } catch (error) {
          rejectPromise(error);
        }
      }, 250);
    };

    const timer = setTimeout(() => terminate({ timeout: true }), check.timeout_ms);
    child.on('error', (error) => {
      stderr.push(Buffer.from(`${error.name}: ${error.message}\n`));
    });
    child.on('exit', () => {
      try {
        // Descendants can keep inherited pipes open after the group leader exits.
        // Reap them at leader exit, then let `close` drain the remaining streams.
        forceKillGroup();
      } catch (error) {
        rejectPromise(error);
      }
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      removeParentHandlers();
      try {
        // A successful command may have detached descendants. Reap the whole
        // process group before accepting its result as complete evidence.
        forceKillGroup();
      } catch (error) {
        rejectPromise(error);
        return;
      }
      closeResult = { status: code, signal };
      forceCompleted = true;
      maybeFinish();
    });
  });
}

export async function runChecks({ repoRoot, checks, outputDirectory, headSha, verifyGitState = true, enforceTrustedCatalog = true }) {
  validateCheckCatalog(checks);
  if (enforceTrustedCatalog) assertTrustedChecks(checks);
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('headSha must be a full lowercase Git SHA.');
  if (!isSafeRepositoryPath(outputDirectory)) throw new Error('Output directory must be repository-relative and contain no patterns.');
  const resolvedRoot = realpathSync(resolve(repoRoot));
  if (verifyGitState) assertExactGitState(resolvedRoot, headSha);
  const resolvedOutput = resolve(resolvedRoot, outputDirectory);
  const outputRelationship = relative(resolvedRoot, resolvedOutput);
  if (outputRelationship.startsWith('..') || isAbsolute(outputRelationship)) throw new Error('Output directory must be inside the repository.');
  const realOutput = ensureSafeDirectory(resolvedRoot, resolvedOutput);
  const results = [];
  const isolatedHome = mkdtempSync(join(tmpdir(), 'mypet-engineering-runner-'));
  try {
    for (const check of checks) {
      const started = performance.now();
      const workingDirectory = realpathSync(join(resolvedRoot, check.cwd));
      const workingRelationship = relative(resolvedRoot, workingDirectory);
      if (workingRelationship.startsWith('..') || isAbsolute(workingRelationship)) {
        throw new Error(`Check ${check.id} working directory escapes the repository.`);
      }
      const result = await executeCheck(check, workingDirectory, minimalEnvironment(isolatedHome));
      const durationMs = Math.round(performance.now() - started);
      const outputFile = posix.join(outputDirectory, `${check.id}.log`);
      const rawOutput = [result.stdout ?? '', result.stderr ?? ''].join('');
      const timedOut = result.timedOut;
      const combined = check.output_policy === 'summary_only'
        ? `Check ${check.id} completed with exit code ${result.status ?? 1}; raw output suppressed by policy.\n`
        : redactOutput(rawOutput);
      safeWrite(join(realOutput, `${check.id}.log`), combined);
      const outputSha256 = createHash('sha256').update(combined).digest('hex');
      const checkResult = Object.freeze({
        id: check.id,
        category: check.category,
        status: result.status === 0 && !timedOut && !result.outputLimitExceeded ? 'PASS' : 'FAIL',
        exit_code: result.status ?? 1,
        duration_ms: durationMs,
        output_file: outputFile,
        output_sha256: outputSha256,
        head_sha: headSha,
        timed_out: timedOut,
        output_truncated: result.outputTruncated,
        output_limit_exceeded: result.outputLimitExceeded,
      });
      EXECUTED_RESULTS.set(checkResult, { reviewed_catalog: enforceTrustedCatalog, exact_git_state: verifyGitState });
      results.push(checkResult);
      if (verifyGitState) assertExactGitState(resolvedRoot, headSha);
    }
  } finally {
    rmSync(isolatedHome, { recursive: true, force: true });
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

function verifyEvidenceArtifact(repoRoot, result) {
  if (!repoRoot) return { code: 'EVIDENCE_ROOT_MISSING', check_id: result.id, message: 'Certification requires a repository root to verify evidence artifacts.' };
  if (!isSafeRepositoryPath(result.output_file)) return { code: 'INVALID_EVIDENCE_PATH', check_id: result.id, message: 'Evidence path is not safe and repository-relative.' };
  try {
    const root = realpathSync(resolve(repoRoot));
    const lexical = resolve(root, result.output_file);
    const relationship = relative(root, lexical);
    if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error('outside repository');
    const metadata = lstatSync(lexical);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('not a regular file');
    if (metadata.size > 50 * 1024 * 1024) throw new Error('artifact exceeds the 50 MiB evidence limit');
    const real = realpathSync(lexical);
    const realRelationship = relative(root, real);
    if (realRelationship.startsWith('..') || isAbsolute(realRelationship)) throw new Error('outside repository');
    const descriptor = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW);
    let actualHash;
    try {
      const openedMetadata = fstatSync(descriptor);
      if (!openedMetadata.isFile() || openedMetadata.size > 50 * 1024 * 1024) throw new Error('opened artifact is not a bounded regular file');
      actualHash = createHash('sha256').update(readFileSync(descriptor)).digest('hex');
    } finally {
      closeSync(descriptor);
    }
    if (actualHash !== result.output_sha256) return { code: 'EVIDENCE_HASH_MISMATCH', check_id: result.id, message: 'Evidence artifact digest does not match the recorded hash.' };
    return null;
  } catch (error) {
    return { code: 'EVIDENCE_ARTIFACT_INVALID', check_id: result.id, message: `Evidence artifact cannot be verified: ${error.message}` };
  }
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
  mergePolicy = 'all_required_pass_no_warnings',
  repoRoot,
}) {
  const blockers = [];
  const resultsById = new Map(checkResults.map((result) => [result.id, result]));
  for (const id of requiredCheckIds) {
    const result = resultsById.get(id);
    if (!result) blockers.push({ code: 'REQUIRED_CHECK_MISSING', check_id: id, message: 'Required check was not executed.' });
    else if (!hasEvidence(result)) blockers.push({ code: 'MISSING_EXECUTION_EVIDENCE', check_id: id, message: 'Check result lacks exit code, duration, or output artifact.' });
    else {
      const provenance = EXECUTED_RESULTS.get(result);
      if (provenance?.reviewed_catalog !== true || provenance.exact_git_state !== true) blockers.push({ code: 'UNTRUSTED_EXECUTION_EVIDENCE', check_id: id, message: 'Check evidence was not produced from the reviewed command catalog under exact Git-state enforcement.' });
      if (result.head_sha !== currentSha) blockers.push({ code: 'STALE_HEAD_EVIDENCE', check_id: id, message: 'Check evidence was captured for a different Git head.' });
      if (result.status !== 'PASS' || result.exit_code !== 0) blockers.push({ code: 'REQUIRED_CHECK_FAILED', check_id: id, message: 'Required check did not pass.' });
      const artifactBlocker = verifyEvidenceArtifact(repoRoot, result);
      if (artifactBlocker) blockers.push(artifactBlocker);
    }
  }
  for (const [name, report] of [['SCOPE', scopeReport], ['DEPENDENCIES', dependencyReport], ['SECURITY', securityReport]]) {
    const allowedStatuses = mergePolicy === 'all_required_pass' && name !== 'SECURITY' ? new Set(['PASS', 'WARN']) : new Set(['PASS']);
    if (!allowedStatuses.has(report?.status)) blockers.push({ code: `${name}_NOT_PASSING`, message: `${name} report is ${report?.status ?? 'MISSING'} under ${mergePolicy}.` });
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
