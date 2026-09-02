#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`Preview branch environment error: ${message}`);
  process.exit(2);
}

const sourcePath = process.argv[2];
const outputPath = process.env.GITHUB_ENV || process.argv[3];
const parentRef = (process.env.SUPABASE_PARENT_PROJECT_REF || '').trim();

if (!sourcePath) fail('branch environment file path is required');
if (!outputPath) fail('GITHUB_ENV or an explicit output path is required');
if (!parentRef) fail('SUPABASE_PARENT_PROJECT_REF is required');
if (!fs.existsSync(sourcePath)) fail(`branch environment file does not exist: ${sourcePath}`);

const allowed = new Set([
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL',
  'SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
]);

const values = new Map();
for (const rawLine of fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) continue;
  const key = line.slice(0, separator).trim();
  if (!allowed.has(key)) continue;
  let value = line.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  values.set(key, value);
}

const postgresUrl = values.get('POSTGRES_URL_NON_POOLING') || values.get('POSTGRES_URL');
if (!postgresUrl) fail('Supabase branch output did not contain a PostgreSQL URL');

let parsed;
try {
  parsed = new URL(postgresUrl);
} catch {
  fail('Supabase branch PostgreSQL URL is invalid');
}
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  fail(`unexpected PostgreSQL URL protocol: ${parsed.protocol}`);
}
if (!parsed.username || !parsed.password) fail('preview database credentials are incomplete');

const hostMatch = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
if (!hostMatch) fail(`preview database must use a direct Supabase host, received ${parsed.hostname}`);
const previewRef = hostMatch[1];
if (previewRef === parentRef) {
  fail('refusing to run preview certification against the parent Supabase project');
}

const declaredRef = values.get('SUPABASE_PROJECT_REF');
if (declaredRef && declaredRef !== previewRef) {
  fail(`branch project ref mismatch: ${declaredRef} != ${previewRef}`);
}

const jdbcUrl = `jdbc:postgresql://${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}${parsed.search}`;
const user = decodeURIComponent(parsed.username);
const password = decodeURIComponent(parsed.password);

for (const secret of [postgresUrl, password]) {
  process.stdout.write(`::add-mask::${secret}\n`);
}

const lines = [
  `PREVIEW_PROJECT_REF=${previewRef}`,
  `PREVIEW_DATABASE_URL=${postgresUrl}`,
  `PREVIEW_JDBC_URL=${jdbcUrl}`,
  `PREVIEW_DB_USER=${user}`,
  `PREVIEW_DB_PASSWORD=${password}`,
];
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Preview branch environment prepared for project ${previewRef}.`);
