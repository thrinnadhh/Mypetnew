import {
  catalogRouteSlugs,
  getCatalogRoute,
  normalizeRouteParam,
} from '@/services/route-catalog';

describe('customer catalog route registry', () => {
  it('normalizes Expo route parameters', () => {
    expect(normalizeRouteParam(['Food-Nutrition'])).toBe('food-nutrition');
    expect(normalizeRouteParam(undefined)).toBe('');
  });

  it('resolves catalog aliases to live category queries', () => {
    expect(getCatalogRoute('food-nutrition')?.category).toBe('food');
    expect(getCatalogRoute('toys-enrichment')?.category).toBe('toys');
    expect(getCatalogRoute('travel-apparel')?.category).toBe('travel');
    expect(getCatalogRoute('waste-management')?.category).toBe('waste');
  });

  it('marks new arrivals as a live recency query', () => {
    const route = getCatalogRoute('new-arrivals');
    expect(route).toMatchObject({
      slug: 'new-arrivals',
      onlyNewArrivals: true,
    });
    expect(route?.category).toBeUndefined();
  });

  it('publishes every supported alias once', () => {
    expect(new Set(catalogRouteSlugs).size).toBe(catalogRouteSlugs.length);
    expect(catalogRouteSlugs).toContain('food');
    expect(catalogRouteSlugs).toContain('food-nutrition');
    expect(catalogRouteSlugs).toContain('new-arrivals');
  });

  it('rejects unknown route slugs', () => {
    expect(getCatalogRoute('not-a-real-category')).toBeNull();
  });
});
