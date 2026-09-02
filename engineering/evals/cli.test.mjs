import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHECK_CATALOG } from '../lib/certifier.mjs';
import { validateSprintContract } from '../lib/contract.mjs';

const repositoryRoot = new URL('../../', import.meta.url).pathname;

test('committed sprint examples satisfy semantic validation and reviewed check IDs', () => {
  const knownCheckIds = CHECK_CATALOG.map(({ id }) => id);
  for (const name of ['autonomous-engineering-foundation.sprint.json', 'merchant-barcode-pos.sprint.json']) {
    const contract = JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
    const report = validateSprintContract(contract, { knownCheckIds });
    assert.equal(report.valid, true, `${name}: ${report.errors.join('; ')}`);
  }
});

test('CLI emits a machine-readable contract validation report', () => {
  const output = execFileSync('node', [
    'engineering/bin/mypet-engineering.mjs',
    'contract',
    'validate',
    '--contract',
    'engineering/examples/autonomous-engineering-foundation.sprint.json',
  ], { cwd: repositoryRoot, encoding: 'utf8' });

  const report = JSON.parse(output);
  assert.equal(report.report_type, 'contract');
  assert.equal(report.status, 'success');
  assert.equal(report.valid, true);
});
