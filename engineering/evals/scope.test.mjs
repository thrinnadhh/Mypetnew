import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateScope } from '../lib/scope.mjs';
import { validContract } from './helpers.mjs';

function change(path, extra = {}) {
  return {
    path,
    status: 'M',
    additions: 4,
    deletions: 1,
    patch: '+meaningful change\n-old behavior',
    ...extra,
  };
}

test('backend-only change inside declared backend scope is accepted', () => {
  const contract = validContract();
  contract.scope.allowed_paths = ['backend/**'];
  contract.scope.forbidden_paths = [];
  contract.workers[0].allowed_paths = ['backend/**'];
  contract.workers[0].forbidden_paths = [];

  const report = evaluateScope({
    contract,
    changes: [change('backend/src/main/kotlin/in/mypetnew/Pet.kt')],
  });

  assert.equal(report.status, 'PASS');
  assert.equal(report.files[0].classification, 'IN_SCOPE');
});

test('unrelated admin change is likely scope creep', () => {
  const report = evaluateScope({
    contract: validContract(),
    changes: [change('apps/admin-web/src/page.tsx')],
  });

  assert.equal(report.status, 'FAIL');
  assert.equal(report.files[0].classification, 'LIKELY_SCOPE_CREEP');
});

test('dependency manifest addition requires justification even inside scope', () => {
  const contract = validContract();
  contract.scope.allowed_paths = ['apps/merchant-app/**'];
  contract.scope.forbidden_paths = [];
  contract.workers[0].allowed_paths = ['apps/merchant-app/**'];
  contract.workers[0].forbidden_paths = [];

  const report = evaluateScope({
    contract,
    changes: [change('apps/merchant-app/package.json', { status: 'M' })],
  });

  assert.equal(report.status, 'WARN');
  assert.equal(report.files[0].classification, 'JUSTIFICATION_REQUIRED');
  assert.ok(report.warnings.some((warning) => warning.code === 'DEPENDENCY_MANIFEST_CHANGED'));
});

test('migration outside declared scope is likely scope creep', () => {
  const report = evaluateScope({
    contract: validContract(),
    changes: [change('backend/src/main/resources/db/migration/V99__surprise.sql', { status: 'A' })],
  });

  assert.equal(report.status, 'FAIL');
  assert.ok(report.scope_creep.some((finding) => finding.code === 'OUTSIDE_ALLOWED_PATHS'));
  assert.ok(report.scope_creep.some((finding) => finding.code === 'DATABASE_MIGRATION_OUT_OF_SCOPE'));
});

test('formatting-only unrelated file is detected', () => {
  const report = evaluateScope({
    contract: validContract(),
    changes: [
      change('docs/product/PRD.md', {
        additions: 2,
        deletions: 2,
        patch: '+same words   \n-same words',
      }),
    ],
  });

  assert.equal(report.status, 'FAIL');
  assert.ok(report.scope_creep.some((finding) => finding.code === 'FORMATTING_ONLY_OUTSIDE_SCOPE'));
});

test('CI, security, public API, generated, lockfile churn, and test deletion signals are deterministic', () => {
  const contract = validContract();
  contract.scope.allowed_paths = ['**'];
  contract.scope.forbidden_paths = [];

  const report = evaluateScope({
    contract,
    changes: [
      change('.github/workflows/ci.yml'),
      change('backend/src/main/kotlin/in/mypetnew/security/Auth.kt'),
      change('backend/src/main/kotlin/in/mypetnew/application/web/DeliveryControllers.kt'),
      change('contracts/public-api.json'),
      change('generated/client.ts', { status: 'A' }),
      change('apps/customer-app/package-lock.json', { additions: 900, deletions: 850 }),
      change('apps/customer-app/src/foo.test.ts', { status: 'D', additions: 0, deletions: 70 }),
    ],
  });

  const codes = new Set(report.warnings.map(({ code }) => code));
  for (const code of ['CI_CONFIG_CHANGED', 'AUTH_SECURITY_CHANGED', 'PUBLIC_CONTRACT_CHANGED', 'GENERATED_FILE_CHANGED', 'LOCKFILE_CHURN', 'TEST_DELETED']) {
    assert.ok(codes.has(code), `missing ${code}`);
  }
});
