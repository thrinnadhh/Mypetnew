import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSprintContract } from '../lib/contract.mjs';
import { validContract } from './helpers.mjs';

test('valid sprint contract is accepted', () => {
  const report = validateSprintContract(validContract());

  assert.equal(report.status, 'success');
  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
});

test('missing sprint objective is rejected', () => {
  const contract = validContract();
  delete contract.sprint.objective;

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /sprint\.objective/);
});

test('malformed worker definition is rejected', () => {
  const contract = validContract();
  delete contract.workers[0].evidence_requirements;
  contract.workers[0].allowed_paths = 'engineering/**';

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /workers\[0\]\.allowed_paths/);
  assert.match(report.errors.join('\n'), /workers\[0\]\.evidence_requirements/);
});

test('changed path matching a forbidden rule is rejected', () => {
  const report = validateSprintContract(validContract(), {
    changedPaths: ['backend/src/main/kotlin/in/mypetnew/Unsafe.kt'],
  });

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /forbidden path/);
});

test('path rules cannot escape the repository or encode commands', () => {
  const contract = validContract();
  contract.scope.allowed_paths = ['../outside/**', 'engineering/**; touch owned'];

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /safe repository-relative pattern/);
});
