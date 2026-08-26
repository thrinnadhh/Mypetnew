import type { CatalogMediaAsset, MerchantListing } from './api';
import {
  applyCatalogMediaAttachment,
  canUploadCatalogMedia,
  catalogErrorMessage,
  catalogMediaQuotaLabel,
  validateCatalogMediaAsset,
} from './model';

const listing: MerchantListing = {
  id: 'listing-1',
  organizationId: 'org-1',
  outletId: 'outlet-1',
  barcodeType: 'INTERNAL',
  normalizedBarcode: 'INTERNAL-1',
  name: 'Food',
  kind: 'PRODUCT',
  commerceMode: 'COMMERCE',
  mrpPaise: 10000,
  sellingPricePaise: 9000,
  category: 'food',
  imageUrls: [],
  status: 'ACTIVE',
  version: 3,
  createdAt: '2026-08-21T00:00:00Z',
  updatedAt: '2026-08-21T00:00:00Z',
};

function asset(overrides: Partial<CatalogMediaAsset> = {}): CatalogMediaAsset {
  return {
    uri: 'file:///tmp/pet.jpg',
    name: 'pet.jpg',
    type: 'image/jpeg',
    size: 1024,
    ...overrides,
  };
}

describe('M4 Merchant catalog media model', () => {
  it('allows only active listings below the five image boundary', () => {
    expect(canUploadCatalogMedia(listing)).toBe(true);
    expect(canUploadCatalogMedia({ ...listing, status: 'INACTIVE' })).toBe(false);
    expect(canUploadCatalogMedia({ ...listing, imageUrls: ['1', '2', '3', '4', '5'] })).toBe(false);
    expect(catalogMediaQuotaLabel({ ...listing, imageUrls: ['1', '2'] })).toBe('2/5 images');
  });

  it.each([
    asset({ name: 'pet.jpg', type: 'image/jpeg' }),
    asset({ name: 'pet.jpeg', type: 'image/jpeg' }),
    asset({ name: 'pet.png', type: 'image/png', uri: 'content://media/pet.png' }),
    asset({ name: 'pet.webp', type: 'image/webp', uri: 'ph://asset-id' }),
  ])('accepts supported local picker asset %#', (candidate) => {
    expect(() => validateCatalogMediaAsset(candidate)).not.toThrow();
  });

  it('rejects external URL sources extension mismatch and oversized selections before upload', () => {
    expect(() => validateCatalogMediaAsset(asset({ uri: 'https://evil.example/pet.jpg' }))).toThrow();
    expect(() => validateCatalogMediaAsset(asset({ name: 'pet.svg', type: 'image/jpeg' }))).toThrow();
    expect(() => validateCatalogMediaAsset(asset({ name: 'pet.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }))).toThrow();
  });

  it('applies only canonical server attachment output and advances optimistic version', () => {
    const updated = applyCatalogMediaAttachment(listing, {
      mediaId: 'media-1',
      listingId: listing.id,
      position: 0,
      publicUrl: 'https://catalog.example/catalog/org-1/outlet-1/listing-1/media-1',
      contentType: 'image/jpeg',
      sizeBytes: 4,
      listingVersion: 4,
    });
    expect(updated.imageUrls).toEqual(['https://catalog.example/catalog/org-1/outlet-1/listing-1/media-1']);
    expect(updated.version).toBe(4);
  });

  it('fails stale media state closed and maps retryable upload errors', () => {
    expect(() => applyCatalogMediaAttachment({ ...listing, imageUrls: ['existing'] }, {
      mediaId: 'media-2',
      listingId: listing.id,
      position: 0,
      publicUrl: 'https://catalog.example/catalog/org-1/outlet-1/listing-1/media-2',
      contentType: 'image/jpeg',
      sizeBytes: 4,
      listingVersion: 4,
    })).toThrow();

    const quota = new Error('quota');
    quota.name = 'CATALOG_MEDIA_QUOTA_EXCEEDED';
    expect(catalogErrorMessage(quota)).toContain('maximum of 5');

    const storage = new Error('storage');
    storage.name = 'CATALOG_MEDIA_STORE_UNAVAILABLE';
    expect(catalogErrorMessage(storage)).toContain('Retry the same upload');
  });
});
