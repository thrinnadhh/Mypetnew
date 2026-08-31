import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyRouteHygiene } from './verify-route-hygiene.mjs';

function createTempRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mypetnew-hygiene-test-'));
  const appDir = path.join(tmpDir, 'apps/merchant-app/app');
  fs.mkdirSync(appDir, { recursive: true });
  return { tmpDir, appDir };
}

function cleanupTempRepo(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

test('clean route tree passes verification', () => {
  const { tmpDir, appDir } = createTempRepo();
  try {
    fs.writeFileSync(path.join(appDir, '_layout.tsx'), 'export default function Layout() { return null; }\n');
    fs.writeFileSync(path.join(appDir, 'index.tsx'), 'export default function Index() { return null; }\n');
    fs.writeFileSync(path.join(appDir, 'dashboard.tsx'), 'export default function Dashboard() { return null; }\n');

    const result = verifyRouteHygiene(tmpDir);
    assert.equal(result.status, 'CLEAN');
    assert.equal(result.scannedCount, 3);
  } finally {
    cleanupTempRepo(tmpDir);
  }
});

test('test file inside route tree fails verification', () => {
  const { tmpDir, appDir } = createTempRepo();
  try {
    fs.writeFileSync(path.join(appDir, 'index.tsx'), 'export default function Index() { return null; }\n');
    fs.writeFileSync(path.join(appDir, 'inventory.test.tsx'), 'describe("test", () => {});\n');

    assert.throws(
      () => verifyRouteHygiene(tmpDir),
      /FORBIDDEN_TEST_FILE.*inventory\.test\.tsx/
    );
  } finally {
    cleanupTempRepo(tmpDir);
  }
});

test('spec file inside nested route folder fails verification', () => {
  const { tmpDir, appDir } = createTempRepo();
  try {
    const subDir = path.join(appDir, 'nested');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'route.spec.ts'), 'test("nested", () => {});\n');

    assert.throws(
      () => verifyRouteHygiene(tmpDir),
      /FORBIDDEN_TEST_FILE.*nested\/route\.spec\.ts/
    );
  } finally {
    cleanupTempRepo(tmpDir);
  }
});

test('__tests__ folder inside route tree fails verification', () => {
  const { tmpDir, appDir } = createTempRepo();
  try {
    const testDir = path.join(appDir, '__tests__');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'helper.ts'), 'export const a = 1;\n');

    assert.throws(
      () => verifyRouteHygiene(tmpDir),
      /FORBIDDEN_DIRECTORY.*__tests__/
    );
  } finally {
    cleanupTempRepo(tmpDir);
  }
});

test('file with jest.mock content inside route tree fails verification', () => {
  const { tmpDir, appDir } = createTempRepo();
  try {
    fs.writeFileSync(
      path.join(appDir, 'custom-route.tsx'),
      'jest.mock("something");\nexport default function Route() { return null; }\n'
    );

    assert.throws(
      () => verifyRouteHygiene(tmpDir),
      /FORBIDDEN_TEST_CONTENT.*custom-route\.tsx/
    );
  } finally {
    cleanupTempRepo(tmpDir);
  }
});

test('actual repository merchant-app route tree is clean', () => {
  const result = verifyRouteHygiene();
  assert.equal(result.status, 'CLEAN');
  assert.ok(result.scannedCount >= 12);
});
