import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync } from 'node:fs';

import { analyzeFileHistory } from '../lib/archaeology.mjs';
import { commitFile, git, initGitRepo } from './helpers.mjs';

test('extracts introduction, bug-fix history, line origins, and co-change files', () => {
  const root = initGitRepo();
  const introduced = commitFile(root, 'pet.txt', 'pet\n', 'feat: introduce pet record');
  commitFile(root, 'friend.txt', 'friend\n', 'feat: add friend');
  appendFileSync(`${root}/pet.txt`, 'safe\n');
  appendFileSync(`${root}/friend.txt`, 'updated\n');
  git(root, ['add', '--', 'pet.txt', 'friend.txt']);
  const fixed = git(root, ['commit', '--quiet', '-m', 'fix: prevent pet regression']) || git(root, ['rev-parse', 'HEAD']);
  const fixedSha = git(root, ['rev-parse', 'HEAD']);

  const report = analyzeFileHistory({ repoRoot: root, path: 'pet.txt', maxCommits: 20 });

  assert.equal(report.status, 'success');
  assert.equal(report.introduced.commit, introduced);
  assert.ok(report.commits.some(({ commit, subject }) => commit === fixedSha && /fix:/.test(subject)));
  assert.ok(report.bug_fix_commits.some(({ commit }) => commit === fixedSha));
  assert.ok(report.co_changed_files.some(({ path }) => path === 'friend.txt'));
  assert.ok(report.line_origins.length >= 2);
  assert.equal(fixed, '');
});

test('rejects paths outside the repository', () => {
  const root = initGitRepo();
  commitFile(root, 'pet.txt', 'pet\n', 'feat: pet');

  assert.throws(
    () => analyzeFileHistory({ repoRoot: root, path: '../secret.txt' }),
    /repository-relative/,
  );
});
