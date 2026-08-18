import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('home live-discovery state contract', () => {
  it('distinguishes loading, retryable error, and serviceability-empty states', () => {
    const home = source('src/screens/home-screen.tsx');

    expect(home).toMatch(/type LiveDiscoveryState = 'loading' \| 'ready' \| 'empty' \| 'error'/);
    expect(home).toMatch(/setLiveDiscoveryState\('loading'\)/);
    expect(home).toMatch(/setLiveDiscoveryState\('error'\)/);
    expect(home).toMatch(/\? 'ready'\s*:\s*'empty'/);
    expect(home).toContain('Nearby services could not load');
    expect(home).toContain('No serviceable providers found here yet');
    expect(home).toMatch(/setDiscoveryReloadKey\(\(value\) => value \+ 1\)/);
    expect(home).toContain('onPress={openLocationModal}');
  });

  it('keeps discovery-state actions accessible and at the canonical minimum target height', () => {
    const home = source('src/screens/home-screen.tsx');

    expect(home).toContain("import { touchTarget } from '@/design/tokens'");
    expect(home).toContain('accessibilityLiveRegion="polite"');
    expect(home).toContain('accessibilityRole="button"');
    expect(home).toMatch(/discoveryStateAction:\s*\{[^}]*minHeight:\s*touchTarget/);
  });
});
