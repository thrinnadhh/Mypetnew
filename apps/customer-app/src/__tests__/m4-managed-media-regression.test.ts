import {
  mapListingToCommerceProduct,
  type PublicListingDetail,
  type PublicListingSummary,
} from '../services/customer-catalog';

const base: PublicListingSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
  outletId: '22222222-2222-4222-8222-222222222222',
  outletName: 'Managed Media Store',
  name: 'Managed Food',
  kind: 'PRODUCT',
  category: 'food',
  mrpPaise: 12000,
  sellingPricePaise: 10000,
  currency: 'INR',
  commerceMode: 'COMMERCE',
  availableQuantity: 5,
  pickupEnabled: true,
  createdAt: '2026-08-20T00:00:00Z',
};

describe('M4 Customer managed catalog media regression', () => {
  it('propagates only the canonical media URLs supplied by the live public catalog', () => {
    const canonical = [
      'https://catalog.example/storage/v1/object/public/catalog-media/catalog/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'https://catalog.example/storage/v1/object/public/catalog-media/catalog/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    const detail: PublicListingDetail = {
      ...base,
      primaryImageUrl: canonical[0],
      imageUrls: canonical,
      description: 'Live managed listing',
    };

    const product = mapListingToCommerceProduct(detail);

    expect(product.imageUrl).toBe(canonical[0]);
    expect(product.galleryImages).toEqual(canonical);
    expect(product.galleryImages).not.toContain('https://cdn.example.com/legacy.jpg');
  });

  it('does not synthesize a demo or external image when live catalog media is absent', () => {
    const product = mapListingToCommerceProduct({ ...base, primaryImageUrl: null });

    expect(product.imageUrl).toBeUndefined();
    expect(product.galleryImages).toEqual([]);
  });

  it('uses the managed primary image for list summaries without inventing gallery entries', () => {
    const managed = 'https://catalog.example/storage/v1/object/public/catalog-media/catalog/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const product = mapListingToCommerceProduct({ ...base, primaryImageUrl: managed });

    expect(product.imageUrl).toBe(managed);
    expect(product.galleryImages).toEqual([managed]);
  });
});
