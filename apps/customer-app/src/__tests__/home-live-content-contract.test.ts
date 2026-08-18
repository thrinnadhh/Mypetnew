import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('home live-content contract', () => {
  it('keeps promotional fixtures behind explicit demo mode', () => {
    const content = source('src/constants/content.ts');
    const home = source('src/screens/home-screen.tsx');
    const carousel = source('src/components/ui/banner-carousel.tsx');

    expect(content).toContain("import { appConfig } from '@/utils/app-config'");
    expect(content).toMatch(/const DEMO_PROMO_BANNERS: PromoBanner\[\]/);
    expect(content).toMatch(/PROMO_BANNERS: PromoBanner\[\] = appConfig\.allowDemoMode \? DEMO_PROMO_BANNERS : \[\]/);
    expect(home).toMatch(/useState<PromoBanner\[\]>\(PROMO_BANNERS\)/);
    expect(home).toMatch(/setBanners\(items\.length > 0 \? items : PROMO_BANNERS\)/);
    expect(home).toMatch(/catch\(\(\) => setBanners\(PROMO_BANNERS\)\)/);
    expect(carousel).toMatch(/banners = \[\]/);
    expect(carousel).toMatch(/const safeBanners = useMemo\(\(\) => banners, \[banners\]\)/);
    expect(carousel).not.toContain('banners.length > 0 ? banners : PROMO_BANNERS');
    expect(carousel).toContain('uri={item.imageUrl}');
    expect(carousel).not.toContain('DEMO_BANNER_IMAGES');
  });

  it('keeps fixture guide articles out of live Home fallbacks', () => {
    const home = source('src/screens/home-screen.tsx');

    expect(home).toMatch(/useState<DiscoveryCardItem\[\]>\(appConfig\.allowDemoMode \? GUIDES : \[\]\)/);
    expect(home).toMatch(/catch\(\(\) => setGuideItems\(appConfig\.allowDemoMode \? GUIDES : \[\]\)\)/);
  });

  it('prevents demo media URLs from rendering as live provider or guide imagery', () => {
    const image = source('src/components/ui/resilient-remote-image.tsx');

    expect(image).toMatch(/const DEMO_MEDIA_URIS = new Set<string>\(Object\.values\(DEMO_MEDIA\)\)/);
    expect(image).toMatch(/!appConfig\.allowDemoMode && DEMO_MEDIA_URIS\.has\(candidate\)/);
    expect(image).toMatch(/return undefined/);
  });

  it('uses the canonical touch target for Home navigation controls', () => {
    const home = source('src/screens/home-screen.tsx');

    expect(home).toContain("import { touchTarget } from '@/design/tokens'");
    expect(home).toContain('accessibilityLabel="Open voice search"');
    expect(home).toContain('style={styles.searchAccessory}');
    expect(home).toMatch(/searchAccessory:\s*\{[^}]*width:\s*touchTarget[^}]*height:\s*touchTarget/s);
    expect(home).toContain('style={styles.sectionActionTarget}');
    expect(home).toMatch(/sectionActionTarget:\s*\{[^}]*minHeight:\s*touchTarget[^}]*minWidth:\s*touchTarget/s);
    expect(home).toMatch(/filterChip:\s*\{[^}]*minHeight:\s*touchTarget/s);
  });
});
