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

test('worker dependency cycles are rejected', () => {
  const contract = validContract();
  contract.workers.push({
    ...structuredClone(contract.workers[0]),
    id: 'reviewer',
    dependencies: ['tooling'],
  });
  contract.workers[0].dependencies = ['reviewer'];

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /dependency graph contains a cycle/);
});

test('unknown reviewed check IDs are rejected when a catalog is supplied', () => {
  const contract = validContract();
  contract.workers[0].required_check_ids = ['made_up_check'];

  const report = validateSprintContract(contract, { knownCheckIds: ['engineering_evals'] });

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /unknown check id made_up_check/);
});

test('worker glob cannot authorize paths outside the sprint glob language', () => {
  const contract = validContract();
  contract.scope.allowed_paths = ['apps/*/src/**'];
  contract.scope.forbidden_paths = [];
  contract.workers[0].allowed_paths = ['apps/customer-app/**'];
  contract.workers[0].forbidden_paths = [];

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /outside sprint scope/);
});

test('worker glob cannot escape through a sibling prefix', () => {
  const contract = validContract();
  contract.workers[0].allowed_paths = ['engineering*'];

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('engineering*') && error.includes('outside sprint scope')));
});

test('malformed null worker returns errors instead of throwing', () => {
  const contract = validContract();
  contract.workers = [null];

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /workers\[0\] must be an object/);
});

test('malformed worker arrays return errors instead of throwing', () => {
  const contract = validContract();
  contract.workers[0].dependencies = 42;
  contract.workers[0].required_check_ids = 42;

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /workers\[0\]\.dependencies/);
  assert.match(report.errors.join('\n'), /workers\[0\]\.required_check_ids/);
});

test('certification required checks include every worker-required check', () => {
  const contract = validContract();
  contract.workers[0].required_check_ids = ['security_scan'];

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /worker-required check security_scan/);
});

test('arrays declared unique by the schema reject duplicate entries', () => {
  const contract = validContract();
  contract.scope.allowed_paths.push('engineering/**');

  const report = validateSprintContract(contract);

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('scope.allowed_paths') && error.includes('unique')));
});
