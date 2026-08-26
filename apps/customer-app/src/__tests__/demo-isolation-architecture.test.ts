import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

// Demo fixtures live under src/demo/ so they cannot leak into production bundles
// through src/services re-exports. This guard pins that architecture: services may
// consume demo fixtures only through the explicit allowlist of modules that gate
// them behind appConfig.allowDemoMode, and screens/components may reference them
// only for dev-only media fallbacks.

const root = process.cwd();

// Demo-gated service modules allowed to value-import demo fixtures.
const SERVICES_DEMO_IMPORT_ALLOWLIST = new Set([
  'src/services/appointment-booking.ts',
  'src/services/customer-catalog.ts',
  'src/services/paginated-catalog.ts',
  'src/services/provider-discovery.ts',
]);

// UI files allowed to value-import DEMO_MEDIA fallbacks from src/demo.
const UI_DEMO_IMPORT_ALLOWLIST = new Set([
  'src/components/commerce/CategoryTemplate.tsx',
  'src/components/commerce/ProviderProfileTemplate.tsx',
  'src/components/ui/banner-carousel.tsx',
  'src/components/ui/resilient-remote-image.tsx',
  'src/screens/home-screen.tsx',
]);

function listFiles(relativeDir: string): string[] {
  const absoluteDir = join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...listFiles(relativePath));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(relativePath);
  }
  return files;
}

function demoValueImports(relativePath: string): string[] {
  const source = readFileSync(join(root, relativePath), 'utf8');
  const imports: string[] = [];
  const pattern = /import\s+(type\s+)?([\s\S]*?)from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const [, typeMarker, , modulePath] = match;
    if (!modulePath.includes('/demo/')) continue;
    if (!typeMarker) imports.push(modulePath);
  }
  return imports;
}

describe('demo isolation architecture', () => {
  it('keeps legacy fixture modules out of src/services', () => {
    expect(existsSync(join(root, 'src/services/catalog-data.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/services/demo-customer-data.ts'))).toBe(false);
    // Production types stay importable without pulling fixture values into bundles.
    const types = readFileSync(join(root, 'src/services/catalog-types.ts'), 'utf8');
    expect(types).toMatch(/export interface CommerceProduct/);
    expect(types).not.toMatch(/export (const|let|var|function|class)/);
    expect(readFileSync(join(root, 'src/demo/customer-data.ts'), 'utf8')).toContain('DEMO_MEDIA');
    expect(readFileSync(join(root, 'src/demo/catalog-data.ts'), 'utf8')).toContain('SAMPLE_PRODUCTS');
  });

  it('allows demo fixture value-imports only in explicitly gated service modules', () => {
    for (const relativePath of listFiles('src/services')) {
      const imports = demoValueImports(relativePath);
      if (SERVICES_DEMO_IMPORT_ALLOWLIST.has(relativePath)) continue;
      expect(imports).toEqual([]);
    }
    for (const relativePath of SERVICES_DEMO_IMPORT_ALLOWLIST) {
      expect(demoValueImports(relativePath).length).toBeGreaterThan(0);
    }
  });

  it('never lets screens or components pull demo data beyond the migrated DEMO_MEDIA fallbacks', () => {
    for (const dir of ['src/app', 'src/screens', 'src/components', 'src/constants', 'src/context', 'src/hooks']) {
      for (const relativePath of listFiles(dir)) {
        if (UI_DEMO_IMPORT_ALLOWLIST.has(relativePath)) continue;
        expect(demoValueImports(relativePath)).toEqual([]);
      }
    }
    for (const relativePath of UI_DEMO_IMPORT_ALLOWLIST) {
      expect(statSync(join(root, relativePath)).isFile()).toBe(true);
      expect(demoValueImports(relativePath)).toEqual(['@/demo/customer-data']);
    }
  });
});
