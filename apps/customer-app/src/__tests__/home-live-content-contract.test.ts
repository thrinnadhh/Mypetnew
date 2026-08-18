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
});
