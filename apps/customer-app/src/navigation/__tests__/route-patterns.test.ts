import fs from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(__dirname, '../../app');

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) return [];
    return [absolute];
  });
}

function canonicalPattern(file: string): string | null {
  const relative = path.relative(APP_DIR, file).replaceAll(path.sep, '/').replace(/\.tsx$/, '');
  const segments = relative.split('/');
  const leaf = segments.at(-1);
  if (!leaf || leaf === '_layout' || leaf.startsWith('+')) return null;

  const normalized = segments
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .filter((segment, index, all) => !(index === all.length - 1 && segment === 'index'))
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '[[...]]';
      if (/^\[\.\.\..+\]$/.test(segment)) return '[...]';
      if (/^\[.+\]$/.test(segment)) return '[]';
      return segment;
    });

  return normalized.join('/');
}

describe('Expo Router route patterns', () => {
  it('does not define two screens for the same URL pattern', () => {
    const patterns = new Map<string, string[]>();

    for (const file of routeFiles(APP_DIR)) {
      const pattern = canonicalPattern(file);
      if (pattern === null) continue;
      const relative = path.relative(APP_DIR, file).replaceAll(path.sep, '/');
      patterns.set(pattern, [...(patterns.get(pattern) ?? []), relative]);
    }

    const collisions = [...patterns.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([pattern, files]) => `${pattern || '/'} => ${files.join(', ')}`);

    expect(collisions).toEqual([]);
  });
});
