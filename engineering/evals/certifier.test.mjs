import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { certify, runChecks, selectChecks, validateCheckCatalog } from '../lib/certifier.mjs';

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
});

test('command runner does not pass unrelated secret environment values', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-'));
  process.env.MYPET_SECRET_SENTINEL = 'must-not-leak';
  const [result] = runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'env_probe', category: 'SECURITY', cwd: '.', command: ['node', '-e', 'process.stdout.write(process.env.MYPET_SECRET_SENTINEL ?? "absent")'], timeout_ms: 1000 }],
  });

  assert.equal(result.status, 'PASS');
  assert.equal(readFileSync(join(root, result.output_file), 'utf8'), 'absent');
  assert.match(result.output_sha256, /^[0-9a-f]{64}$/);
  delete process.env.MYPET_SECRET_SENTINEL;
});

test('command runner rejects a working directory symlink escaping the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'mypet-runner-outside-'));
  mkdirSync(join(root, 'safe'));
  symlinkSync(outside, join(root, 'escape'));

  assert.throws(
    () => runChecks({
      repoRoot: root,
      outputDirectory: 'evidence',
      headSha: 'c'.repeat(40),
      checks: [{ id: 'escape_probe', category: 'SECURITY', cwd: 'escape', command: ['node', '-e', 'process.exit(0)'], timeout_ms: 1000 }],
    }),
    /working directory escapes/,
  );
});

test('command runner enforces catalog timeout', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-runner-timeout-'));
  const [result] = runChecks({
    repoRoot: root,
    outputDirectory: 'evidence',
    headSha: 'c'.repeat(40),
    checks: [{ id: 'timeout_probe', category: 'TESTS', cwd: '.', command: ['node', '-e', 'setTimeout(() => {}, 5000)'], timeout_ms: 25 }],
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.timed_out, true);
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
