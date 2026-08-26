import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bannerRoute } from '@/utils/banner-route';
import type { PromoBanner } from '@/constants/content';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function banner(overrides: Partial<PromoBanner> = {}): PromoBanner {
  return {
    id: 'b-test',
    title: 'Test',
    subtitle: 'Test subtitle',
    accent: '#000000',
    durationSec: 3,
    targetType: 'NONE',
    targetValue: null,
    ...overrides,
  } as PromoBanner;
}

describe('H2.2 production completion contracts', () => {
  describe('banner deep-link resolution', () => {
    it('maps CATEGORY targets to category routes with encoding', () => {
      expect(bannerRoute(banner({ targetType: 'CATEGORY', targetValue: 'dog food' }))).toBe(
        '/category/dog%20food',
      );
    });

    it('maps ROUTE targets only when they are in-app absolute paths', () => {
      expect(bannerRoute(banner({ targetType: 'ROUTE', targetValue: '/groom' }))).toBe('/groom');
      expect(bannerRoute(banner({ targetType: 'ROUTE', targetValue: 'https://evil.example/x' }))).toBe('/stores');
    });

    it('maps PRODUCT and STORE targets to their canonical detail routes', () => {
      expect(bannerRoute(banner({ targetType: 'PRODUCT', targetValue: 'L1' }))).toBe(
        '/commerce/product-detail?id=L1',
      );
      expect(bannerRoute(banner({ targetType: 'STORE', targetValue: 'S1' }))).toBe('/shop/S1');
    });

    it('fails safe to stores discovery for missing, blank or unknown targets', () => {
      expect(bannerRoute(banner({ targetType: 'NONE', targetValue: null }))).toBe('/stores');
      expect(bannerRoute(banner({ targetType: 'CATEGORY', targetValue: '   ' }))).toBe('/stores');
      expect(bannerRoute(banner({ targetType: 'MYSTERY' as never, targetValue: 'x' }))).toBe('/stores');
    });
  });

  it('replaces the fabricated vaccination fixture screen with an explicit deferred state', () => {
    const vaccinations = source('src/app/health/vaccinations.tsx');
    expect(vaccinations).not.toMatch(/VACCINATION_RECORDS|Bruno|Luna|Dr\.|City Pet Hospital/);
    expect(vaccinations).not.toMatch(/city-pet-hospital/);
    expect(vaccinations).toContain('Not part of this release yet');
    expect(vaccinations).toMatch(/StateView/);
  });

  it('removes the voice-search pretense from Home', () => {
    const home = source('src/screens/home-screen.tsx');
    expect(home).not.toMatch(/mic|voice/i);
  });

  it('exposes subscription creation from delivered orders', () => {
    const orderDetail = source('src/app/orders/[id].tsx');
    expect(orderDetail).toMatch(/status === 'DELIVERED'/);
    expect(orderDetail).toMatch(/pathname: '\/subscriptions'/);
    expect(orderDetail).toMatch(/sourceOrderId: order\.orderId/);
  });

  it('routes order help requests into the explicit support surface', () => {
    const orderDetail = source('src/app/orders/[id].tsx');
    expect(orderDetail).toMatch(/pathname: '\/support'/);
    expect(orderDetail).toMatch(/orderId: order\.orderId/);
  });

  it('surfaces loyalty wallet and legal pages from the profile screen', () => {
    const profile = source('src/screens/profile-screen.tsx');
    expect(profile).toMatch(/router\.push\('\/wallet' as never\)/);
    expect(profile).toMatch(/router\.push\('\/legal' as never\)/);
  });

  it('keeps proven-dead legacy modules out of the tree', () => {
    const existsSync = (p: string) => {
      try {
        readFileSync(join(process.cwd(), p), 'utf8');
        return true;
      } catch {
        return false;
      }
    };
    expect(existsSync('src/services/customer-orders.ts')).toBe(false);
    expect(existsSync('src/utils/supabase.ts')).toBe(false);
  });
});
