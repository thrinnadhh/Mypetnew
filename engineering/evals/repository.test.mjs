import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { analyzeRepositoryDependencies } from '../lib/repository.mjs';
import { commitFile, git, initGitRepo } from './helpers.mjs';

test('new package manifest with a bounded dependency is reported as introduced', () => {
  const root = initGitRepo();
  const base = commitFile(root, 'README.md', 'baseline\n', 'chore: baseline');
  mkdirSync(`${root}/apps`);
  mkdirSync(`${root}/apps/new-app`);
  writeFileSync(`${root}/apps/new-app/package.json`, '{"dependencies":{"leftpad":"1.0.0"}}\n');
  git(root, ['add', '--', 'apps/new-app/package.json']);
  git(root, ['commit', '--quiet', '-m', 'feat: add app dependency']);

  const report = analyzeRepositoryDependencies({ repoRoot: root, base, head: 'HEAD' });

  assert.equal(report.status, 'WARN');
  assert.ok(report.findings.some(({ code, dependency, baseline: isBaseline }) => code === 'DEPENDENCY_ADDED' && dependency === 'leftpad' && !isBaseline));
});

test('dependency range rejects a base that is not an ancestor of head', () => {
  const root = initGitRepo();
  const base = commitFile(root, 'README.md', 'baseline\n', 'chore: baseline');
  const head = commitFile(root, 'pet.txt', 'pet\n', 'feat: pet');

  assert.throws(
    () => analyzeRepositoryDependencies({ repoRoot: root, base: head, head: base }),
    /base commit must be an ancestor/,
  );
});

test('deleted package manifest produces dependency-removal evidence', () => {
  const root = initGitRepo();
  mkdirSync(`${root}/apps`);
  mkdirSync(`${root}/apps/old-app`);
  const base = commitFile(root, 'apps/old-app/package.json', '{"dependencies":{"leftpad":"1.0.0"}}\n', 'chore: baseline dependency');
  rmSync(`${root}/apps/old-app/package.json`);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'chore: remove old app']);

  const report = analyzeRepositoryDependencies({ repoRoot: root, base, head: 'HEAD' });

  assert.equal(report.status, 'WARN');
  assert.ok(report.findings.some(({ code }) => code === 'MANIFEST_REMOVED'));
  assert.ok(report.findings.some(({ code, dependency }) => code === 'DEPENDENCY_REMOVED' && dependency === 'leftpad'));
});
