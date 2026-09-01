import assert from 'node:assert/strict';
import test from 'node:test';

import { certify, selectChecks, validateCheckCatalog } from '../lib/certifier.mjs';

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
