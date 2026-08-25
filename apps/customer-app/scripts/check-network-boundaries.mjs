import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoots = ['src/services', 'src/hooks', 'src/context'];

const rootsFlagIndex = process.argv.indexOf('--roots');
let roots = defaultRoots;
if (rootsFlagIndex !== -1) {
  const rawValue = process.argv[rootsFlagIndex + 1];
  if (!rawValue || rawValue.startsWith('-')) {
    console.error('--roots requires a comma-separated list of source directories (e.g. --roots src/app,src/screens).');
    process.exit(2);
  }
  roots = rawValue.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (roots.length === 0) {
    console.error('--roots resolved to an empty directory list.');
    process.exit(2);
  }
}
const approvedRawFetch = new Set([
  'src/services/api-client.ts',
]);

const violations = [];

function shouldSkip(relativePath) {
  return relativePath.includes('/__tests__/')
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath)
    || relativePath.endsWith('.d.ts');
}

function visit(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return;
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      visit(relativePath);
      continue;
    }
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name) || shouldSkip(relativePath)) continue;

    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (/\bfetch\s*\(/.test(source) && !approvedRawFetch.has(relativePath)) {
      violations.push(`${relativePath}: raw fetch() is outside the canonical transport boundary`);
    }
    if (/\bAuthorization\s*:/.test(source) && !approvedRawFetch.has(relativePath)) {
      violations.push(`${relativePath}: manual Authorization header is outside the canonical transport boundary`);
    }
  }
}

for (const relativeDir of roots) visit(relativeDir);

if (violations.length > 0) {
  console.error('Customer network architecture guard failed:\n' + violations.map((value) => ` - ${value}`).join('\n'));
  process.exit(1);
}

console.log('Customer network architecture guard passed.');
