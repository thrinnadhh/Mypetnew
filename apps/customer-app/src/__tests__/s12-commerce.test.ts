import { SAMPLE_PRODUCTS, SHOPS_DATA } from '../services/catalog-data';

describe('Sprint S12 Commerce Catalogs & Business Rules', () => {
  test('SAMPLE_PRODUCTS contains valid category taxonomy items', () => {
    expect(SAMPLE_PRODUCTS.length).toBeGreaterThan(0);
    const categories = new Set(SAMPLE_PRODUCTS.map((p) => p.category));
    expect(categories.has('food')).toBe(true);
    expect(categories.has('furniture')).toBe(true);
    expect(categories.has('toys')).toBe(true);
    expect(categories.has('treats')).toBe(true);
  });

  test('New Arrivals filter retrieves items with isNewArrival metadata', () => {
    const newArrivals = SAMPLE_PRODUCTS.filter((p) => p.isNewArrival);
    expect(newArrivals.length).toBeGreaterThan(0);
    newArrivals.forEach((item) => {
      expect(item.isNewArrival).toBe(true);
      expect(item.createdAt).toBeDefined();
    });
  });

  test('SHOPS_DATA provides provider data for all three required shop profiles', () => {
    expect(SHOPS_DATA['petcare-pharmacy']).toBeDefined();
    expect(SHOPS_DATA['the-healthy-hound']).toBeDefined();
    expect(SHOPS_DATA['the-posh-paws']).toBeDefined();

    expect(SHOPS_DATA['petcare-pharmacy'].name).toContain('PetCare Pharmacy');
    expect(SHOPS_DATA['the-healthy-hound'].name).toContain('The Healthy Hound');
    expect(SHOPS_DATA['the-posh-paws'].name).toContain('The Posh Paws');
  });

  test('Product variants possess valid price and stock counts', () => {
    const productWithVariants = SAMPLE_PRODUCTS.find((p) => p.variants.length > 1);
    expect(productWithVariants).toBeDefined();
    if (productWithVariants) {
      expect(productWithVariants.variants.length).toBeGreaterThanOrEqual(2);
      productWithVariants.variants.forEach((v) => {
        expect(v.price).toBeGreaterThan(0);
        expect(v.stockCount).toBeGreaterThanOrEqual(0);
      });
    }
  });
});
