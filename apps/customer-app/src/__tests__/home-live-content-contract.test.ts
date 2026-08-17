import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('home live-content contract', () => {
  it('keeps promotional fixtures behind explicit demo mode', () => {
    const content = source('src/constants/content.ts');
    const home = source('src/screens/home-screen.tsx');

    expect(content).toContain("import { appConfig } from '@/utils/app-config'");
    expect(content).toMatch(/const DEMO_PROMO_BANNERS: PromoBanner\[\]/);
    expect(content).toMatch(/PROMO_BANNERS: PromoBanner\[\] = appConfig\.allowDemoMode \? DEMO_PROMO_BANNERS : \[\]/);
    expect(home).toMatch(/useState<PromoBanner\[\]>\(PROMO_BANNERS\)/);
    expect(home).toMatch(/setBanners\(items\.length > 0 \? items : PROMO_BANNERS\)/);
    expect(home).toMatch(/catch\(\(\) => setBanners\(PROMO_BANNERS\)\)/);
  });
});
