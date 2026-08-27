import type { CatalogMediaAsset, MerchantListing } from './api';
import {
  applyCatalogMediaAttachment,
  canUploadCatalogMedia,
  catalogErrorMessage,
  catalogMediaAssetFromPicker,
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

  it('maps picker metadata to a validated local asset and supplies a safe missing filename', () => {
    expect(catalogMediaAssetFromPicker({
      uri: 'content://media/pet.png',
      fileName: 'pet.png',
      mimeType: 'image/png',
      fileSize: 2048,
    })).toEqual({
      uri: 'content://media/pet.png',
      name: 'pet.png',
      type: 'image/png',
      size: 2048,
      file: undefined,
    });

    const fallback = catalogMediaAssetFromPicker({
      uri: 'file:///tmp/pet.webp',
      fileName: null,
      mimeType: 'image/webp',
      fileSize: 1024,
    });
    expect(fallback.name).toBe('catalog-image.webp');
  });

  it('rejects unsupported picker MIME before upload', () => {
    expect(() => catalogMediaAssetFromPicker({
      uri: 'file:///tmp/pet.svg',
      fileName: 'pet.svg',
      mimeType: 'image/svg+xml',
      fileSize: 100,
    })).toThrow();
  });

  it('rejects external URL sources extension mismatch empty files and oversized selections before upload', () => {
    expect(() => validateCatalogMediaAsset(asset({ uri: 'https://evil.example/pet.jpg' }))).toThrow();
    expect(() => validateCatalogMediaAsset(asset({ name: 'pet.svg', type: 'image/jpeg' }))).toThrow();
    expect(() => validateCatalogMediaAsset(asset({ size: 0 }))).toThrow();
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

    for (const code of [
      'CATALOG_MEDIA_STORE_UNAVAILABLE',
      'CATALOG_MEDIA_FINALIZATION_FAILED',
      'CATALOG_MEDIA_CLEANUP_QUEUE_UNAVAILABLE',
    ]) {
      const retryable = new Error(code);
      retryable.name = code;
      expect(catalogErrorMessage(retryable)).toContain('Retry the same upload');
    }
  });
});
