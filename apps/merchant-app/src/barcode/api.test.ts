import { merchantApiFetch } from '../auth/session';
import type { MerchantListing } from '../catalog/api';
import { resolveMerchantBarcode } from './api';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;

const listing: MerchantListing = {
  id: 'listing-1',
  organizationId: 'org-1',
  outletId: 'outlet-1',
  barcodeType: 'GTIN_13',
  normalizedBarcode: '0123456789012',
  name: 'Dog Food',
  kind: 'PRODUCT',
  commerceMode: 'COMMERCE',
  mrpPaise: 20000,
  sellingPricePaise: 19000,
  category: 'food',
  imageUrls: [],
  status: 'ACTIVE',
  version: 0,
  createdAt: '2026-08-25T00:00:00Z',
  updatedAt: '2026-08-25T00:00:00Z',
};

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => fetchMock.mockReset());

describe('Merchant M4 barcode client', () => {
  it('resolves a normalized barcode inside the selected outlet scope', async () => {
    fetchMock.mockResolvedValue(response(true, {
      barcodeType: 'GTIN_13',
      normalizedBarcode: '0123456789012',
      listing,
    }));

    await expect(resolveMerchantBarcode('outlet-1', 'GTIN_13', '0 123456 789012')).resolves.toMatchObject({
      normalizedBarcode: '0123456789012',
      listing,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchant/barcodes/resolve?outletId=outlet-1&barcodeType=GTIN_13&barcode=0123456789012',
    );
  });

  it('returns a canonical unknown result without creating a listing', async () => {
    fetchMock.mockResolvedValue(response(true, {
      barcodeType: 'GTIN_8',
      normalizedBarcode: '01234565',
      listing: null,
    }));
    await expect(resolveMerchantBarcode('outlet-1', 'GTIN_8', '01234565')).resolves.toMatchObject({ listing: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input before making a request', async () => {
    await expect(resolveMerchantBarcode('outlet-1', 'GTIN_13', '0123456789013')).rejects.toMatchObject({
      name: 'BARCODE_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the canonical backend authorization error', async () => {
    fetchMock.mockResolvedValue(response(false, {
      code: 'MERCHANT_PERMISSION_REQUIRED',
      message: 'The required merchant permission is missing',
    }));
    await expect(resolveMerchantBarcode('outlet-1', 'GTIN_13', '0123456789012')).rejects.toMatchObject({
      name: 'MERCHANT_PERMISSION_REQUIRED',
    });
  });
});
