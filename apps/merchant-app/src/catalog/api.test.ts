import * as Crypto from 'expo-crypto';
import { merchantApiFetch } from '../auth/session';
import {
  catalogMediaCommandKey,
  changeListingStatus,
  createListing,
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  type MerchantListing,
  updateListing,
  uploadCatalogMedia,
} from './api';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'command-uuid') }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;
const uuidMock = Crypto.randomUUID as jest.MockedFunction<typeof Crypto.randomUUID>;

const listing: MerchantListing = {
  id: 'listing-1',
  organizationId: 'org-1',
  outletId: 'outlet-1',
  barcodeType: 'INTERNAL',
  normalizedBarcode: 'DOG-FOOD-1',
  name: 'Dog Food',
  kind: 'PRODUCT',
  commerceMode: 'COMMERCE',
  mrpPaise: 20000,
  sellingPricePaise: 19000,
  category: 'food',
  imageUrls: [],
  status: 'ACTIVE',
  version: 3,
  createdAt: '2026-08-21T00:00:00Z',
  updatedAt: '2026-08-21T01:00:00Z',
};

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  uuidMock.mockReturnValue('command-uuid');
});

describe('Merchant catalog client', () => {
  it('loads current Merchant outlet context', async () => {
    const context = { organizationId: 'org-1', outletIds: ['outlet-1'], permissionsByOutlet: { 'outlet-1': ['CATALOG_WRITE'] } };
    fetchMock.mockResolvedValue(response(true, context));

    await expect(fetchMerchantCatalogContext()).resolves.toEqual(context);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/context');
  });

  it('builds bounded catalog search parameters without sending blank query values', async () => {
    fetchMock.mockResolvedValue(response(true, { items: [listing], page: 2, pageSize: 25, hasNext: true }));

    await expect(fetchCatalogPage('outlet-1', { query: '  dog food ', status: 'ACTIVE', page: 2 })).resolves.toMatchObject({ items: [listing] });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/listings?outletId=outlet-1&page=2&pageSize=25&query=dog+food&status=ACTIVE');

    fetchMock.mockResolvedValue(response(true, { items: [], page: 0, pageSize: 5, hasNext: false }));
    await fetchCatalogPage('outlet-1', { query: '   ', pageSize: 5 });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/merchant/listings?outletId=outlet-1&page=0&pageSize=5');
  });

  it('creates a listing with a unique idempotency key and backend-owned outlet scope', async () => {
    fetchMock.mockResolvedValue(response(true, listing));

    await expect(createListing('outlet-1', {
      barcodeType: 'INTERNAL',
      barcode: 'DOG-FOOD-1',
      name: 'Dog Food',
      kind: 'PRODUCT',
      mrpPaise: 20000,
      sellingPricePaise: 19000,
      category: 'food',
    })).resolves.toEqual(listing);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/listings', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'catalog-create:command-uuid' },
      body: JSON.stringify({
        outletId: 'outlet-1',
        barcodeType: 'INTERNAL',
        barcode: 'DOG-FOOD-1',
        name: 'Dog Food',
        kind: 'PRODUCT',
        mrpPaise: 20000,
        sellingPricePaise: 19000,
        category: 'food',
      }),
    });
  });

  it('sends expectedVersion for update and lifecycle commands', async () => {
    fetchMock.mockResolvedValueOnce(response(true, { ...listing, version: 4, name: 'Dog Food Plus' }));
    await updateListing(listing, {
      name: 'Dog Food Plus',
      mrpPaise: 20000,
      sellingPricePaise: 18500,
      category: 'food',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/merchant/listings/listing-1', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': 'catalog-update:command-uuid' },
      body: JSON.stringify({
        outletId: 'outlet-1',
        expectedVersion: 3,
        name: 'Dog Food Plus',
        mrpPaise: 20000,
        sellingPricePaise: 18500,
        category: 'food',
      }),
    });

    fetchMock.mockResolvedValueOnce(response(true, { ...listing, status: 'INACTIVE', version: 4 }));
    await changeListingStatus(listing, 'INACTIVE');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/merchant/listings/listing-1/deactivate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'catalog-deactivate:command-uuid' },
      body: JSON.stringify({ outletId: 'outlet-1', expectedVersion: 3 }),
    });

    fetchMock.mockResolvedValueOnce(response(true, { ...listing, status: 'ACTIVE', version: 4 }));
    await changeListingStatus({ ...listing, status: 'INACTIVE' }, 'ACTIVE');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/merchant/listings/listing-1/activate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'catalog-activate:command-uuid' },
      body: JSON.stringify({ outletId: 'outlet-1', expectedVersion: 3 }),
    });
  });

  it('uploads only multipart bytes to the managed media endpoint and keeps caller-owned retry key stable', async () => {
    const attachment = {
      mediaId: 'media-1',
      listingId: listing.id,
      position: 0,
      publicUrl: 'https://catalog.example/catalog/org-1/outlet-1/listing-1/media-1',
      contentType: 'image/jpeg' as const,
      sizeBytes: 4,
      listingVersion: 4,
    };
    fetchMock.mockResolvedValue(response(true, attachment));
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: 'image/jpeg' });
    const key = 'catalog-media:stable-retry-key';

    await expect(uploadCatalogMedia(listing, {
      uri: 'blob:local-image',
      name: 'pet.jpg',
      type: 'image/jpeg',
      size: 4,
      file,
    }, key)).resolves.toEqual(attachment);

    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/merchant/listings/listing-1/media?outletId=outlet-1&expectedVersion=3');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Idempotency-Key': key,
      'Content-Type': 'multipart/form-data; boundary=mypetnew-commanduuid',
    });
    expect(init?.body).toBeInstanceOf(Blob);
    expect(String(init?.body)).not.toContain('https://');

    fetchMock.mockResolvedValue(response(true, attachment));
    await uploadCatalogMedia(listing, {
      uri: 'blob:local-image',
      name: 'pet.jpg',
      type: 'image/jpeg',
      size: 4,
      file,
    }, key);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'Idempotency-Key': key });
  });

  it('creates a dedicated media idempotency key for a new selection', () => {
    expect(catalogMediaCommandKey()).toBe('catalog-media:command-uuid');
  });

  it.each([
    ['context', () => fetchMerchantCatalogContext()],
    ['search', () => fetchCatalogPage('outlet-1')],
    ['create', () => createListing('outlet-1', { barcodeType: 'INTERNAL', barcode: 'X', name: 'X', kind: 'PRODUCT', mrpPaise: 1, sellingPricePaise: 1, category: 'other' })],
    ['update', () => updateListing(listing, { name: 'X', mrpPaise: 1, sellingPricePaise: 1, category: 'other' })],
    ['lifecycle', () => changeListingStatus(listing, 'INACTIVE')],
  ] as const)('surfaces canonical server error code for %s failures', async (_name, operation) => {
    fetchMock.mockResolvedValue(response(false, { code: 'CATALOG_VERSION_CONFLICT', message: 'Refresh and retry' }));
    await expect(operation()).rejects.toMatchObject({ name: 'CATALOG_VERSION_CONFLICT', message: 'Refresh and retry' });
  });

  it('uses a fallback message when an error body cannot be decoded', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: jest.fn().mockRejectedValue(new Error('bad json')) } as unknown as Response);
    await expect(fetchCatalogPage('outlet-1')).rejects.toThrow('Could not load catalog listings.');
  });
});
