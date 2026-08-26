import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Dictionary = Record<string, unknown>;
type Leaves = Map<string, string>;

const i18nDir = join(__dirname, '..');

function readLocaleFile(fileName: string): Dictionary {
  return JSON.parse(readFileSync(join(i18nDir, fileName), 'utf8')) as Dictionary;
}

function deepMerge(base: Dictionary, overlay: Dictionary): Dictionary {
  const result: Dictionary = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key];
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)
        ? deepMerge(current as Dictionary, value as Dictionary)
        : value;
  }
  return result;
}

function flattenLeaves(node: Dictionary, prefix = ''): Leaves {
  const leaves: Leaves = new Map();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [childPath, childValue] of flattenLeaves(value as Dictionary, path)) {
        leaves.set(childPath, childValue);
      }
    } else {
      leaves.set(path, String(value));
    }
  }
  return leaves;
}

function placeholdersOf(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

const englishLeaves = flattenLeaves(
  deepMerge(deepMerge(readLocaleFile('en.json'), readLocaleFile('s10-en.json')), readLocaleFile('production-auth-en.json')),
);
const hindiLeaves = flattenLeaves(
  deepMerge(deepMerge(readLocaleFile('hi.json'), readLocaleFile('s10-hi.json')), readLocaleFile('production-auth-hi.json')),
);
const teluguLeaves = flattenLeaves(readLocaleFile('te.json'));

const localeLeaves: Array<[string, Leaves]> = [
  ['en', englishLeaves],
  ['hi', hindiLeaves],
  ['te', teluguLeaves],
];

describe('i18n locale parity', () => {
  it('has no Hindi keys missing from English', () => {
    expect([...englishLeaves.keys()].filter((key) => !hindiLeaves.has(key))).toEqual([]);
  });

  it('has no extra Hindi keys beyond English', () => {
    expect([...hindiLeaves.keys()].filter((key) => !englishLeaves.has(key))).toEqual([]);
  });

  it('has no Telugu keys missing from English', () => {
    expect([...englishLeaves.keys()].filter((key) => !teluguLeaves.has(key))).toEqual([]);
  });

  it('has no extra Telugu keys beyond English', () => {
    expect([...teluguLeaves.keys()].filter((key) => !englishLeaves.has(key))).toEqual([]);
  });

  it('pairs every plural key with its {{count}} base across all locales', () => {
    for (const [locale, leaves] of localeLeaves) {
      const violations: string[] = [];
      for (const [key, value] of leaves) {
        if (!key.endsWith('_plural')) continue;
        const baseKey = key.slice(0, -'_plural'.length);
        if (!leaves.has(baseKey)) violations.push(`${locale}:${key} is missing base key ${baseKey}`);
        if (!value.includes('{{count}}')) violations.push(`${locale}:${key} does not interpolate {{count}}`);
        if (!leaves.get(baseKey)?.includes('{{count}}')) violations.push(`${locale}:${baseKey} does not interpolate {{count}}`);
      }
      expect(violations).toEqual([]);
    }
  });

  it.each([
    ['hi', hindiLeaves],
    ['te', teluguLeaves],
  ])('keeps %s interpolation placeholders identical to English', (_locale, leaves) => {
    const mismatches: string[] = [];
    for (const [key, value] of leaves) {
      const englishValue = englishLeaves.get(key);
      if (englishValue === undefined) continue;
      if (placeholdersOf(englishValue).join('|') !== placeholdersOf(value).join('|')) {
        mismatches.push(`${key}: en={${placeholdersOf(englishValue).join(',')}} ${_locale}={${placeholdersOf(value).join(',')}}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('has no empty leaf values in any locale', () => {
    for (const [locale, leaves] of localeLeaves) {
      const emptyKeys = [...leaves.entries()].filter(([, value]) => value.trim() === '').map(([key]) => `${locale}:${key}`);
      expect(emptyKeys).toEqual([]);
    }
  });

  it('reports matching leaf counts across all locales', () => {
    process.stdout.write(`English keys: ${englishLeaves.size} / Hindi keys: ${hindiLeaves.size} / Telugu keys: ${teluguLeaves.size}\n`);
    expect(hindiLeaves.size).toBe(englishLeaves.size);
    expect(teluguLeaves.size).toBe(englishLeaves.size);
  });
});
