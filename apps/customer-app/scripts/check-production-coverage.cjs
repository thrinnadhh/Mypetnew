#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const summaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error(`ERROR: coverage summary not found: ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const globalThresholds = {
  statements: 80,
  branches: 70,
  functions: 85,
  lines: 80,
};

const criticalThresholds = {
  statements: 90,
  lines: 90,
  branches: 65,
  functions: 75,
};

const criticalFiles = [
  'src/auth/otp-auth.ts',
  'src/contracts/api-error.ts',
  'src/services/appointment-booking.ts',
  'src/services/chat.ts',
  'src/services/customer-cases.ts',
  'src/services/customer-history.ts',
  'src/services/customer-orders.ts',
  'src/services/customer-payments.ts',
  'src/services/customer-profile.ts',
  'src/services/loyalty.ts',
  'src/services/medical-documents.ts',
  'src/services/recurring-orders.ts',
  'src/utils/app-config.ts',
  'src/utils/supabase.ts',
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

for (const relativePath of criticalFiles) {
  const match = normalizedEntries.find(([key]) => key.endsWith(`/${relativePath}`));
  if (!match) {
    failures.push(`${relativePath}: critical module is absent from the coverage report`);
    continue;
  }
  assertThresholds(relativePath, match[1], criticalThresholds, failures);
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
