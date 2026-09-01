import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeDependencyState } from '../lib/dependency.mjs';

test('detects cross-app version inconsistencies and unbounded npm versions', () => {
  const report = analyzeDependencyState({
    manifests: [
      { path: 'apps/a/package.json', content: JSON.stringify({ dependencies: { react: '19.2.3', risky: '*' } }) },
      { path: 'apps/b/package.json', content: JSON.stringify({ dependencies: { react: '18.3.1' } }) },
    ],
    lockfiles: [],
    gradleFiles: [],
    changes: [],
  });

  const codes = new Set(report.findings.map(({ code }) => code));
  assert.ok(codes.has('VERSION_INCONSISTENCY'));
  assert.ok(codes.has('UNBOUNDED_VERSION'));
});

test('detects package manifest and lockfile disagreement', () => {
  const report = analyzeDependencyState({
    manifests: [
      { path: 'apps/a/package.json', content: JSON.stringify({ dependencies: { react: '19.2.3' } }) },
    ],
    lockfiles: [
      {
        path: 'apps/a/package-lock.json',
        content: JSON.stringify({ packages: { '': { dependencies: { react: '18.3.1' } } } }),
      },
    ],
    gradleFiles: [],
    changes: [],
  });

  assert.ok(report.findings.some(({ code }) => code === 'LOCKFILE_MANIFEST_DISAGREEMENT'));
});

test('detects duplicate Gradle coordinates and suspicious dependency churn', () => {
  const report = analyzeDependencyState({
    manifests: [],
    lockfiles: [],
    gradleFiles: [
      {
        path: 'backend/build.gradle.kts',
        content: 'implementation("org.example:pet:1.0")\nimplementation("org.example:pet:1.0")\n',
      },
    ],
    changes: [
      { path: 'backend/build.gradle.kts', additions: 40, deletions: 35 },
      { path: 'apps/a/package-lock.json', additions: 600, deletions: 550 },
    ],
  });

  const codes = new Set(report.findings.map(({ code }) => code));
  assert.ok(codes.has('DUPLICATE_GRADLE_DEPENDENCY'));
  assert.ok(codes.has('SUSPICIOUS_DEPENDENCY_CHURN'));
});

test('reports newly added dependencies from before/after manifest pairs', () => {
  const report = analyzeDependencyState({
    manifests: [],
    lockfiles: [],
    gradleFiles: [],
    changes: [],
    manifestDiffs: [
      {
        path: 'apps/a/package.json',
        before: JSON.stringify({ dependencies: { react: '19.2.3' } }),
        after: JSON.stringify({ dependencies: { react: '19.2.3', leftpad: '^1.0.0' } }),
      },
    ],
  });

  assert.ok(report.findings.some(({ code, dependency }) => code === 'DEPENDENCY_ADDED' && dependency === 'leftpad'));
});
