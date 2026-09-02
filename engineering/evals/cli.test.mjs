import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CHECK_CATALOG } from '../lib/certifier.mjs';
import { validateSprintContract } from '../lib/contract.mjs';
import { commitFile, git, initGitRepo, validContract } from './helpers.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliPath = fileURLToPath(new URL('../bin/mypet-engineering.mjs', import.meta.url));

function scopedFixtureRepository() {
  const root = initGitRepo();
  const base = commitFile(root, 'package.json', '{"private":true}\n', 'chore: baseline');
  mkdirSync(`${root}/engineering`);
  const contract = validContract();
  contract.sprint.starting_sha = base;
  writeFileSync(`${root}/engineering/sprint.json`, `${JSON.stringify(contract, null, 2)}\n`);
  writeFileSync(`${root}/engineering/tool.mjs`, 'export const ready = true;\n');
  git(root, ['add', '--', 'engineering/sprint.json', 'engineering/tool.mjs']);
  git(root, ['commit', '--quiet', '-m', 'feat: add scoped engineering tool']);
  return { root, base };
}

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

test('CLI dogfoods scope and dependency analysis against the foundation sprint', () => {
  const { root, base } = scopedFixtureRepository();
  const scope = JSON.parse(execFileSync('node', [
    cliPath,
    'scope',
    '--contract',
    'engineering/sprint.json',
    '--head',
    'HEAD',
  ], { cwd: root, encoding: 'utf8' }));
  assert.equal(scope.status, 'PASS');
  assert.equal(scope.scope_creep.length, 0);

  const dependency = JSON.parse(execFileSync('node', [
    cliPath,
    'dependency',
    '--base',
    base,
    '--head',
    'HEAD',
  ], { cwd: root, encoding: 'utf8' }));
  assert.equal(dependency.status, 'PASS');
  assert.equal(dependency.introduced_finding_count, 0);
});

test('CLI returns bounded Git archaeology for a tracked toolkit file', () => {
  const { root } = scopedFixtureRepository();
  const report = JSON.parse(execFileSync('node', [
    cliPath,
    'archaeology',
    '--path',
    'engineering/tool.mjs',
    '--max-commits',
    '5',
  ], { cwd: root, encoding: 'utf8' }));

  assert.equal(report.status, 'success');
  assert.equal(report.path, 'engineering/tool.mjs');
  assert.ok(report.commits.length >= 1);
});

test('CLI certification plan fails closed without executed evidence', () => {
  const { root } = scopedFixtureRepository();
  const result = spawnSync('node', [
    cliPath,
    'certify',
    '--contract',
    'engineering/sprint.json',
    '--head',
    'HEAD',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.final, 'NOT_CERTIFIED');
  assert.ok(report.blockers.some(({ code }) => code === 'REQUIRED_CHECK_MISSING'));
  assert.equal(report.security.status, 'BLOCKED');
});

test('CLI refuses contract and output symlinks that escape the repository', () => {
  const { root } = scopedFixtureRepository();
  const outside = initGitRepo();
  writeFileSync(join(outside, 'outside-contract.json'), JSON.stringify(validContract()));
  symlinkSync(join(outside, 'outside-contract.json'), join(root, 'contract-link.json'));
  mkdirSync(join(root, 'evidence', 'generated'), { recursive: true });
  symlinkSync(outside, join(root, 'evidence', 'generated', 'output-link'));

  const inputResult = spawnSync('node', [cliPath, 'contract', 'validate', '--contract', 'contract-link.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(inputResult.status, 1);
  assert.match(inputResult.stderr, /regular file, not a symlink/);

  const outputResult = spawnSync('node', [
    cliPath,
    'contract',
    'validate',
    '--contract',
    'engineering/sprint.json',
    '--output',
    'evidence/generated/output-link/new/report.json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(outputResult.status, 1);
  assert.equal(existsSync(join(outside, 'new')), false);
});

test('CLI report output cannot overwrite repository or Git metadata', () => {
  const { root } = scopedFixtureRepository();
  const metadataPath = join(root, '.git', 'description');
  const before = readFileSync(metadataPath, 'utf8');
  const result = spawnSync('node', [
    cliPath,
    'contract',
    'validate',
    '--contract',
    'engineering/sprint.json',
    '--output',
    '.git/description',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence\/generated/);
  assert.equal(readFileSync(metadataPath, 'utf8'), before);
});

test('CLI rejects unknown command options instead of falling back silently', () => {
  const result = spawnSync('node', [
    'engineering/bin/mypet-engineering.mjs',
    'contract',
    'validate',
    '--contract',
    'engineering/examples/autonomous-engineering-foundation.sprint.json',
    '--haed',
    'HEAD',
  ], { cwd: repositoryRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported option/);
});

test('CLI scope fails closed instead of omitting dirty working-tree changes', () => {
  const { root } = scopedFixtureRepository();
  writeFileSync(join(root, 'engineering', 'dirty.mjs'), 'export const dirty = true;\n');
  const result = spawnSync('node', [
    cliPath,
    'scope',
    '--contract',
    'engineering/sprint.json',
    '--head',
    'HEAD',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.dirty_paths.includes('engineering/dirty.mjs'));

  const certification = spawnSync('node', [
    cliPath,
    'certify',
    '--contract',
    'engineering/sprint.json',
    '--head',
    'HEAD',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(certification.status, 3, certification.stderr);
  const certificationReport = JSON.parse(certification.stdout);
  assert.equal(certificationReport.final, 'NOT_CERTIFIED');
  assert.ok(certificationReport.blockers.some(({ code }) => code === 'DIRTY_WORKTREE'));
});
