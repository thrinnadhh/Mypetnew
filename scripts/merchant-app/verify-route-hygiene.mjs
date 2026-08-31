#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_FILE_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
];

const FORBIDDEN_DIR_NAMES = new Set([
  '__tests__',
  '__mocks__',
  'fixtures',
  '__fixtures__',
]);

const FORBIDDEN_CONTENT_PATTERNS = [
  /\bjest\.(mock|spyOn|fn|requireActual|requireMock)\(/,
  /(?<!\.)\bdescribe\s*\(/,
  /(?<!\.)\bexpect\s*\(/,
  /(?<!\.)\btest\s*\(\s*['"`]/,
  /(?<!\.)\bit\s*\(\s*['"`]/,
];

export function verifyRouteHygiene(repoRoot) {
  const root = repoRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const appDir = path.join(root, 'apps/merchant-app/app');

  if (!fs.existsSync(appDir)) {
    throw new Error(`Merchant app route directory does not exist: ${appDir}`);
  }

  const violations = [];
  const scannedFiles = [];

  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(appDir, fullPath);

      if (entry.isDirectory()) {
        if (FORBIDDEN_DIR_NAMES.has(entry.name)) {
          violations.push({
            type: 'FORBIDDEN_DIRECTORY',
            path: relativePath,
            reason: `Test/fixture directory "${entry.name}" must not exist inside apps/merchant-app/app`,
          });
        }
        scan(fullPath);
      } else if (entry.isFile()) {
        scannedFiles.push(relativePath);

        for (const pattern of FORBIDDEN_FILE_PATTERNS) {
          if (pattern.test(entry.name)) {
            violations.push({
              type: 'FORBIDDEN_TEST_FILE',
              path: relativePath,
              reason: `Test file "${entry.name}" must not exist inside apps/merchant-app/app`,
            });
          }
        }

        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
            if (pattern.test(content)) {
              violations.push({
                type: 'FORBIDDEN_TEST_CONTENT',
                path: relativePath,
                reason: `File "${relativePath}" contains test execution pattern: ${pattern.toString()}`,
              });
              break;
            }
          }
        } catch {
          // Ignore unreadable files
        }
      }
    }
  }

  scan(appDir);

  if (violations.length > 0) {
    const details = violations
      .map((v) => `  - [${v.type}] ${v.path}: ${v.reason}`)
      .join('\n');
    throw new Error(
      `Merchant app route hygiene violations detected (${violations.length}):\n${details}\n\nMove all test files, mocks, and fixtures to apps/merchant-app/src/__tests__/ or appropriate src/ locations.`
    );
  }

  return {
    scannedCount: scannedFiles.length,
    scannedFiles,
    status: 'CLEAN',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = verifyRouteHygiene();
    console.log(`✓ Merchant app route hygiene verified clean (${result.scannedCount} routes scanned).`);
  } catch (error) {
    console.error(`✗ Route hygiene check failed: ${error.message}`);
    process.exit(1);
  }
}
