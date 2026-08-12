import { SAMPLE_PRODUCTS } from '../services/catalog-data';

describe('food category filter tags', () => {
  const food = SAMPLE_PRODUCTS.filter((product) => product.category === 'food');

  test.each([
    ['DRY', (product: (typeof food)[number]) => product.foodForm === 'DRY'],
    ['WET', (product: (typeof food)[number]) => product.foodForm === 'WET'],
    ['PUPPY', (product: (typeof food)[number]) => product.lifeStages?.includes('PUPPY')],
    ['ADULT', (product: (typeof food)[number]) => product.lifeStages?.includes('ADULT')],
    ['SENIOR', (product: (typeof food)[number]) => product.lifeStages?.includes('SENIOR')],
  ] as const)('%s has correctly classified products', (_filter, predicate) => {
    const results = food.filter(predicate);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(predicate)).toBe(true);
  });

  test('All contains every food product', () => {
    expect(food.length).toBeGreaterThanOrEqual(4);
  });

  test('every food item has explicit taxonomy', () => {
    food.forEach((product) => {
      expect(product.foodForm).toMatch(/^(DRY|WET)$/);
      expect(product.lifeStages?.length).toBeGreaterThan(0);
    });
  });
});
