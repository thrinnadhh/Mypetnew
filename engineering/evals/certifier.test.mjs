import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHECK_CATALOG, certify, runChecks, selectChecks, validateCheckCatalog } from '../lib/certifier.mjs';
import { commitFile, initGitRepo } from './helpers.mjs';

async function waitForFile(path, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test('backend-only diff selects backend checks', () => {
  assert.deepEqual(
    selectChecks(['backend/src/main/kotlin/in/mypetnew/Pet.kt']).map(({ id }) => id),
    ['backend_verify'],
  );
});

test('merchant-only diff selects merchant checks', () => {
  assert.deepEqual(
    selectChecks(['apps/merchant-app/src/app/index.tsx']).map(({ id }) => id),
    ['merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests'],
  );
});

test('cross-stack API contract change selects backend and affected clients', () => {
  const ids = selectChecks(['contracts/merchant-operations/openapi.json']).map(({ id }) => id);

  assert.deepEqual(ids, [
    'backend_verify',
    'customer_typecheck',
    'customer_tests',
    'merchant_routes',
    'merchant_typecheck',
    'merchant_lint',
    'merchant_tests',
    'captain_typecheck',
    'captain_tests',
  ]);
});

test('public controller and root Gradle infrastructure changes select cross-stack checks', () => {
  const controllerIds = selectChecks(['backend/src/main/kotlin/in/mypetnew/application/web/PetController.kt']).map(({ id }) => id);
  assert.ok(controllerIds.includes('backend_verify'));
  assert.ok(controllerIds.includes('customer_typecheck'));
  assert.ok(controllerIds.includes('merchant_tests'));
  assert.ok(controllerIds.includes('captain_tests'));

  const pluralControllerIds = selectChecks(['backend/src/main/kotlin/in/mypetnew/application/web/DeliveryControllers.kt']).map(({ id }) => id);
  assert.ok(pluralControllerIds.includes('customer_tests'));
  assert.ok(pluralControllerIds.includes('merchant_tests'));
  assert.ok(pluralControllerIds.includes('captain_tests'));

  assert.deepEqual(
    selectChecks(['gradle/wrapper/gradle-wrapper.properties']).map(({ id }) => id),
    ['backend_verify'],
  );

  const merchantScriptIds = selectChecks(['scripts/merchant-app/verify-route-hygiene.mjs']).map(({ id }) => id);
  assert.deepEqual(merchantScriptIds, ['merchant_routes', 'merchant_typecheck', 'merchant_lint', 'merchant_tests']);
});

test('failed required check prevents certification', () => {
  const report = certify({
    startingSha: 'a'.repeat(40),
    currentSha: 'b'.repeat(40),
    changedFiles: ['backend/src/main/kotlin/in/mypetnew/Pet.kt'],
    requiredCheckIds: ['backend_verify'],
    checkResults: [
      { id: 'backend_verify', status: 'FAIL', exit_code: 1, duration_ms: 12, output_file: 'reports/backend.log' },
    ],
    scopeReport: { status: 'PASS' },
    dependencyReport: { status: 'PASS' },
    securityReport: { status: 'PASS' },
  });

  assert.equal(report.final, 'NOT_CERTIFIED');
  assert.equal(report.status, 'error');
});

test('a check without executed evidence cannot pass certification', () => {
  const report = certify({
    startingSha: 'a'.repeat(40),
    currentSha: 'b'.repeat(40),
    changedFiles: ['engineering/lib/contract.mjs'],
    requiredCheckIds: ['engineering_evals'],
    checkResults: [{ id: 'engineering_evals', status: 'PASS' }],
    scopeReport: { status: 'PASS' },
    dependencyReport: { status: 'PASS' },
    securityReport: { status: 'PASS' },
  });

  assert.equal(report.final, 'NOT_CERTIFIED');
  assert.ok(report.blockers.some((blocker) => blocker.code === 'MISSING_EXECUTION_EVIDENCE'));
});

test('check catalog only accepts argument arrays and safe working directories', () => {
  assert.throws(
    () => validateCheckCatalog([{ id: 'unsafe', command: 'npm test; touch owned', cwd: '.' }]),
    /argument array/,
  );
  assert.throws(
    () => validateCheckCatalog([{ id: 'unsafe', command: ['npm', 'test'], cwd: '../outside' }]),
    /working directory/,
  );
  assert.throws(
    () => validateCheckCatalog([{ id: 'unsafe', category: 'TESTS', command: ['node', '-e', 'process.exit(0)'], cwd: '.', timeout_ms: 1000 }]),
    /inline interpreter code/,
  );
});

test('reviewed catalog entries and commands are immutable', () => {
  const check = CHECK_CATALOG.find(({ id }) => id === 'security_scan');
  assert.throws(() => {
    check.command[0] = 'node';
  }, TypeError);
  assert.throws(() => {
    CHECK_CATALOG.push(check);
  }, TypeError);
  assert.equal(check.command[0], 'bash');
});

test('command runner does not pass unrelated secret environment values', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-'));
  writeFileSync(join(root, 'probe.mjs'), 'process.stdout.write(process.env.MYPET_SECRET_SENTINEL ?? "absent")\n');
  process.env.MYPET_SECRET_SENTINEL = 'must-not-leak';
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'env_probe', category: 'SECURITY', cwd: '.', command: ['node', 'probe.mjs'], timeout_ms: 1000 }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });

  assert.equal(result.status, 'PASS');
  assert.equal(readFileSync(join(root, result.output_file), 'utf8'), 'absent');
  assert.match(result.output_sha256, /^[0-9a-f]{64}$/);
  delete process.env.MYPET_SECRET_SENTINEL;
});

test('command runner rejects a working directory symlink escaping the repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'mypet-runner-outside-'));
  mkdirSync(join(root, 'safe'));
  symlinkSync(outside, join(root, 'escape'));

  await assert.rejects(
    runChecks({
      repoRoot: root,
      outputDirectory: 'evidence',
      headSha: 'c'.repeat(40),
      checks: [{ id: 'escape_probe', category: 'SECURITY', cwd: 'escape', command: ['node', 'probe.mjs'], timeout_ms: 1000 }],
      verifyGitState: false,
      enforceTrustedCatalog: false,
    }),
    /working directory escapes/,
  );
});

test('command runner rejects an output directory symlink escaping the repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-output-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'mypet-runner-output-outside-'));
  symlinkSync(outside, join(root, 'evidence'));

  await assert.rejects(
    runChecks({
      repoRoot: root,
      outputDirectory: 'evidence/generated/nested',
      headSha: 'c'.repeat(40),
      checks: [{ id: 'output_probe', category: 'SECURITY', cwd: '.', command: ['node', 'probe.mjs'], timeout_ms: 1000 }],
      verifyGitState: false,
      enforceTrustedCatalog: false,
    }),
    /output parent must be a real directory/,
  );
  assert.equal(existsSync(join(outside, 'generated')), false);
});

test('command runner enforces catalog timeout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-timeout-'));
  writeFileSync(join(root, 'timeout.mjs'), 'setTimeout(() => {}, 5000)\n');
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'timeout_probe', category: 'TESTS', cwd: '.', command: ['node', 'timeout.mjs'], timeout_ms: 25 }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.timed_out, true);
});

test('command runner refuses dirty or mismatched exact-head evidence', async () => {
  const root = initGitRepo();
  const headSha = commitFile(root, '.gitignore', 'evidence/\n', 'chore: initialize runner fixture');
  appendFileSync(join(root, '.gitignore'), 'later/\n');

  await assert.rejects(
    runChecks({
      repoRoot: root,
      outputDirectory: 'evidence',
      headSha,
      checks: [{ id: 'head_probe', category: 'SECURITY', cwd: '.', command: ['node', 'probe.mjs'], timeout_ms: 1000 }],
      enforceTrustedCatalog: false,
    }),
    /working tree must be clean/,
  );

  const cleanRoot = initGitRepo();
  const oldHead = commitFile(cleanRoot, '.gitignore', 'evidence/\n', 'chore: baseline');
  commitFile(cleanRoot, 'probe.mjs', 'process.stdout.write("ok")\n', 'feat: add probe');
  await assert.rejects(
    runChecks({
      repoRoot: cleanRoot,
      outputDirectory: 'evidence',
      headSha: oldHead,
      checks: [{ id: 'head_probe', category: 'SECURITY', cwd: '.', command: ['node', 'probe.mjs'], timeout_ms: 1000 }],
      enforceTrustedCatalog: false,
    }),
    /does not match requested evidence head/,
  );

  const ignoredRoot = initGitRepo();
  const ignoredHead = commitFile(ignoredRoot, '.gitignore', 'evidence/\n.env\n', 'chore: ignore evidence and local environment');
  writeFileSync(join(ignoredRoot, '.env'), 'LOCAL_ONLY=value\n');
  await assert.rejects(
    runChecks({
      repoRoot: ignoredRoot,
      outputDirectory: 'evidence',
      headSha: ignoredHead,
      checks: [{ id: 'head_probe', category: 'SECURITY', cwd: '.', command: ['node', 'probe.mjs'], timeout_ms: 1000 }],
      enforceTrustedCatalog: false,
    }),
    /Ignored environment or credential configuration/,
  );
});

test('command runner rejects catalog-shaped commands that were not reviewed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-unreviewed-'));
  writeFileSync(join(root, 'probe.mjs'), 'process.stdout.write("ok")\n');

  await assert.rejects(
    runChecks({
      repoRoot: root,
      outputDirectory: 'evidence',
      headSha: 'c'.repeat(40),
      checks: [{ id: 'security_scan', category: 'SECURITY', cwd: '.', command: ['node', 'probe.mjs'], timeout_ms: 300000, output_policy: 'summary_only' }],
      verifyGitState: false,
    }),
    /does not match the reviewed command catalog/,
  );
});

test('summary-only output policy never persists command output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-sensitive-output-'));
  writeFileSync(join(root, 'leak.mjs'), 'process.stdout.write("SENSITIVE-OUTPUT-SHOULD-NOT-PERSIST"); process.exit(1)\n');
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'sensitive_probe', category: 'SECURITY', cwd: '.', command: ['node', 'leak.mjs'], timeout_ms: 1000, output_policy: 'summary_only' }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });

  const persisted = readFileSync(join(root, result.output_file), 'utf8');
  assert.equal(result.status, 'FAIL');
  assert.doesNotMatch(persisted, /SENSITIVE-OUTPUT-SHOULD-NOT-PERSIST/);
});

test('successful checks cannot leave descendants running on POSIX', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-success-descendant-'));
  const marker = join(root, 'late-marker');
  const started = join(root, 'child-started');
  writeFileSync(join(root, 'child.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(started)}, 'started'); setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'late'), 700);\n`);
  writeFileSync(join(root, 'parent.mjs'), "import { spawn } from 'node:child_process'; const child = spawn(process.execPath, ['child.mjs'], { stdio: 'ignore' }); child.unref(); setTimeout(() => {}, 150);\n");
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'descendant_probe', category: 'TESTS', cwd: '.', command: ['node', 'parent.mjs'], timeout_ms: 2000 }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });

  assert.equal(result.status, 'PASS');
  assert.equal(existsSync(started), true);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
  assert.equal(existsSync(marker), false);
});

test('leader exit reaps descendants that inherit check output pipes on POSIX', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-inherited-pipes-'));
  const marker = join(root, 'late-marker');
  writeFileSync(join(root, 'child.mjs'), `import { writeFileSync } from 'node:fs'; setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'late'), 700);\n`);
  writeFileSync(join(root, 'parent.mjs'), "import { spawn } from 'node:child_process'; const child = spawn(process.execPath, ['child.mjs'], { stdio: 'inherit' }); child.unref();\n");
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'pipe_probe', category: 'TESTS', cwd: '.', command: ['node', 'parent.mjs'], timeout_ms: 350 }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.timed_out, false);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
  assert.equal(existsSync(marker), false);
});

test('terminating the runner also terminates its active check group on POSIX', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-parent-signal-'));
  const marker = join(root, 'late-marker');
  const started = join(root, 'child-started');
  const certifierUrl = new URL('../lib/certifier.mjs', import.meta.url).href;
  writeFileSync(join(root, 'child.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(started)}, 'started'); setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'late'), 700);\n`);
  writeFileSync(join(root, 'runner.mjs'), `import { runChecks } from ${JSON.stringify(certifierUrl)}; await runChecks({ repoRoot: ${JSON.stringify(root)}, outputDirectory: 'evidence', headSha: '${'c'.repeat(40)}', checks: [{ id: 'signal_probe', category: 'TESTS', cwd: '.', command: ['node', 'child.mjs'], timeout_ms: 5000 }], verifyGitState: false, enforceTrustedCatalog: false });\n`);
  const runner = spawn(process.execPath, ['runner.mjs'], { cwd: root, stdio: 'ignore' });
  await waitForFile(started);
  runner.kill('SIGTERM');
  await new Promise((resolvePromise) => runner.once('exit', resolvePromise));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
  assert.equal(existsSync(marker), false);
});

test('timeout terminates the spawned process group on POSIX', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-process-group-'));
  const marker = join(root, 'orphan-marker');
  const started = join(root, 'child-started');
  writeFileSync(join(root, 'child.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(started)}, 'started'); setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'orphan'), 800);\n`);
  writeFileSync(join(root, 'parent.mjs'), "import { spawn } from 'node:child_process'; spawn(process.execPath, ['child.mjs'], { stdio: 'ignore' }); setTimeout(() => {}, 5000);\n");
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'group_probe', category: 'TESTS', cwd: '.', command: ['node', 'parent.mjs'], timeout_ms: 300 }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });

  assert.equal(existsSync(started), true);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));
  assert.equal(result.timed_out, true);
  assert.equal(existsSync(marker), false);
});

test('certification rejects evidence captured for a stale head', () => {
  const currentSha = 'd'.repeat(40);
  const report = certify({
    startingSha: 'a'.repeat(40),
    currentSha,
    changedFiles: ['engineering/lib/contract.mjs'],
    requiredCheckIds: ['engineering_evals'],
    checkResults: [{ id: 'engineering_evals', status: 'PASS', exit_code: 0, duration_ms: 1, output_file: 'evidence/test.log', output_sha256: 'f'.repeat(64), head_sha: 'e'.repeat(40) }],
    scopeReport: { status: 'PASS' },
    dependencyReport: { status: 'PASS' },
    securityReport: { status: 'PASS' },
  });

  assert.equal(report.final, 'NOT_CERTIFIED');
  assert.ok(report.blockers.some(({ code }) => code === 'STALE_HEAD_EVIDENCE'));
});

test('certification verifies evidence existence and digest for executed results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-certifier-artifact-'));
  writeFileSync(join(root, 'pass.mjs'), 'process.stdout.write("verified")\n');
  const headSha = 'c'.repeat(40);
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha,
    checks: [{ id: 'artifact_probe', category: 'TESTS', cwd: '.', command: ['node', 'pass.mjs'], timeout_ms: 1000 }],
    verifyGitState: false,
    enforceTrustedCatalog: false,
  });
  const input = {
    startingSha: 'a'.repeat(40),
    currentSha: headSha,
    changedFiles: ['engineering/tool.mjs'],
    requiredCheckIds: ['artifact_probe'],
    checkResults: [result],
    scopeReport: { status: 'PASS' },
    dependencyReport: { status: 'PASS' },
    securityReport: { status: 'PASS' },
    repoRoot: root,
  };

  const executedButUnreviewed = certify(input);
  assert.equal(executedButUnreviewed.final, 'NOT_CERTIFIED');
  assert.ok(executedButUnreviewed.blockers.some(({ code }) => code === 'UNTRUSTED_EXECUTION_EVIDENCE'));
  assert.ok(!executedButUnreviewed.blockers.some(({ code }) => code === 'EVIDENCE_HASH_MISMATCH'));
  writeFileSync(join(root, result.output_file), 'tampered');
  const tampered = certify(input);
  assert.equal(tampered.final, 'NOT_CERTIFIED');
  assert.ok(tampered.blockers.some(({ code }) => code === 'EVIDENCE_HASH_MISMATCH'));
});

test('certification rejects caller-fabricated evidence even when its artifact hash matches', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-certifier-forgery-'));
  mkdirSync(join(root, 'evidence'));
  writeFileSync(join(root, 'evidence', 'forged.log'), 'forged');
  const report = certify({
    startingSha: 'a'.repeat(40),
    currentSha: 'b'.repeat(40),
    changedFiles: [],
    requiredCheckIds: ['forged'],
    checkResults: [{
      id: 'forged',
      category: 'TESTS',
      status: 'PASS',
      exit_code: 0,
      duration_ms: 1,
      output_file: 'evidence/forged.log',
      output_sha256: 'ccdd35168ab474fa5764a526cfb83621351e23682c5075b2e18d56bddf96aa30',
      head_sha: 'b'.repeat(40),
    }],
    scopeReport: { status: 'PASS' },
    dependencyReport: { status: 'PASS' },
    securityReport: { status: 'PASS' },
    repoRoot: root,
  });

  assert.equal(report.final, 'NOT_CERTIFIED');
  assert.ok(report.blockers.some(({ code }) => code === 'UNTRUSTED_EXECUTION_EVIDENCE'));
});

test('certification rejects reviewed commands executed without exact Git-state enforcement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-certifier-no-git-state-'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', 'secret-scan.sh'), '#!/usr/bin/env bash\nexit 0\n');
  const securityCheck = CHECK_CATALOG.find(({ id }) => id === 'security_scan');
  const [result] = await runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [securityCheck],
    verifyGitState: false,
  });
  const report = certify({
    startingSha: 'a'.repeat(40),
    currentSha: 'c'.repeat(40),
    changedFiles: [],
    requiredCheckIds: ['security_scan'],
    checkResults: [result],
    scopeReport: { status: 'PASS' },
    dependencyReport: { status: 'PASS' },
    securityReport: { status: 'PASS' },
    repoRoot: root,
  });

  assert.equal(report.final, 'NOT_CERTIFIED');
  assert.ok(report.blockers.some(({ code }) => code === 'UNTRUSTED_EXECUTION_EVIDENCE'));
});

test('merge policy permits warnings only when the contract explicitly allows them', () => {
  const input = {
    startingSha: 'a'.repeat(40),
    currentSha: 'b'.repeat(40),
    changedFiles: [],
    requiredCheckIds: [],
    checkResults: [],
    scopeReport: { status: 'WARN' },
    dependencyReport: { status: 'WARN' },
    securityReport: { status: 'PASS' },
  };

  assert.equal(certify({ ...input, mergePolicy: 'all_required_pass' }).final, 'CERTIFIED');
  assert.equal(certify({ ...input, mergePolicy: 'all_required_pass_no_warnings' }).final, 'NOT_CERTIFIED');
});
