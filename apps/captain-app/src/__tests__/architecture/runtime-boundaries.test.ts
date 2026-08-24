import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve(process.cwd(), 'src');

function productionSourceFiles(directory = sourceRoot): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionSourceFiles(absolute);
    }
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

function relative(file: string): string {
  return path.relative(sourceRoot, file).replaceAll(path.sep, '/');
}

function filesMatching(pattern: RegExp): string[] {
  return productionSourceFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map(relative)
    .sort();
}

describe('Captain production architecture boundaries', () => {
  test('raw fetch remains confined to the canonical client and refresh bootstrap', () => {
    expect(filesMatching(/\bfetch\s*\(/)).toEqual(['api/client.ts', 'auth/session.ts']);
  });

  test('manual bearer authorization remains confined to the canonical client', () => {
    expect(filesMatching(/["']Authorization["']\s*,|`Bearer \$\{/)).toEqual(['api/client.ts']);
  });

  test('delivery mutation endpoints remain confined to the dispatch API service', () => {
    expect(
      filesMatching(/\/api\/v1\/captain\/dispatch\/[\s\S]*(?:respond|picked-up|delivered)/),
    ).toEqual(['api/dispatch.ts']);
  });

  test('the removed Supabase fallback cannot be reintroduced into Captain runtime code', () => {
    expect(filesMatching(/(?:from|require\s*\()\s*["']@supabase\/|EXPO_PUBLIC_SUPABASE_/)).toEqual([]);
  });
});
