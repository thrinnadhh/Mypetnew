#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const summaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error(`ERROR: coverage summary not found: ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

// Honest floors measured against the current production suite. These are
// regression tripwires, not aspirational targets; high-risk modules carry
// stricter per-file thresholds below.
const globalThresholds = {
  statements: 72,
  branches: 68,
  functions: 74,
  lines: 76,
};

const criticalThresholds = {
  statements: 90,
  lines: 88,
  branches: 80,
  functions: 85,
};

const recoveryThresholds = {
  statements: 68,
  lines: 70,
  branches: 70,
  functions: 60,
};

const criticalFiles = [
  'src/auth/otp-auth.ts',
  'src/contracts/api-error.ts',
  'src/services/api-client.ts',
  'src/services/backend-capabilities.ts',
  'src/services/customer-payments.ts',
  'src/services/loyalty.ts',
  'src/utils/app-config.ts',
];

const recoveryFiles = [
  'src/services/payment-recovery.ts',
  'src/services/appointment-payment-recovery.ts',
];

function percentage(entry, metric) {
  const value = entry?.[metric]?.pct;
  return typeof value === 'number' ? value : Number.NaN;
}

function assertThresholds(label, entry, thresholds, failures) {
  for (const [metric, minimum] of Object.entries(thresholds)) {
    const actual = percentage(entry, metric);
    if (!Number.isFinite(actual)) {
      failures.push(`${label}: ${metric} coverage is missing`);
      continue;
    }
    if (actual < minimum) {
      failures.push(`${label}: ${metric} ${actual}% is below ${minimum}%`);
    }
  }
}

const failures = [];
assertThresholds('global', summary.total, globalThresholds, failures);

const normalizedEntries = Object.entries(summary)
  .filter(([key]) => key !== 'total')
  .map(([key, value]) => [key.replaceAll('\\', '/'), value]);

function thresholdFor(relativePath) {
  if (recoveryFiles.includes(relativePath)) return recoveryThresholds;
  return criticalThresholds;
}

for (const relativePath of [...criticalFiles, ...recoveryFiles]) {
  const match = normalizedEntries.find(([key]) => key.endsWith(`/${relativePath}`));
  if (!match) {
    failures.push(`${relativePath}: critical module is absent from the coverage report`);
    continue;
  }
  assertThresholds(relativePath, match[1], thresholdFor(relativePath), failures);
}

if (failures.length > 0) {
  console.error('Customer production coverage gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const total = summary.total;
console.log(
  'Customer production coverage gate passed: ' +
  `statements=${percentage(total, 'statements')}% ` +
  `branches=${percentage(total, 'branches')}% ` +
  `functions=${percentage(total, 'functions')}% ` +
  `lines=${percentage(total, 'lines')}% ` +
  `criticalModules=${criticalFiles.length}`,
);
