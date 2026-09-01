import {
  completePosSale,
  findPosSaleByIdempotencyKey,
  getPosSale,
  resolveMerchantBarcode,
} from './api';
import { merchantApiFetch } from '../auth/session';

jest.mock('../auth/session', () => ({
  merchantApiFetch: jest.fn(),
  installationId: jest.fn().mockResolvedValue('test-installation-id'),
}));

describe('Barcode and POS API Client', () => {
  const mockFetch = merchantApiFetch as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves merchant barcode with normalized query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        barcodeType: 'GTIN_13',
        normalizedBarcode: '8901234567890',
        listing: { id: 'listing-1', name: 'Cat Food' },
      }),
    });

    const result = await resolveMerchantBarcode(
      'outlet-1',
      'GTIN_13',
      '8901234567890',
    );

    expect(result.listing?.id).toBe('listing-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/merchant/barcodes/resolve?outletId=outlet-1&barcodeType=GTIN_13&barcode=8901234567890'),
    );
  });

  it('completes POS sale with Idempotency-Key and payload', async () => {
    const mockSaleResponse = {
      id: 'sale-123',
      merchantId: 'merchant-1',
      outletId: 'outlet-1',
      customerId: null,
      lines: { 'listing-1': { first: 2, second: 5000 } },
      totalPaise: 10000,
      paymentDeclaration: 'CASH',
      completedAt: '2026-09-01T12:00:00Z',
      loyaltyAwarded: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSaleResponse,
    });

    const requestPayload = {
      outletId: 'outlet-1',
      paymentDeclaration: 'CASH' as const,
      lines: [{ listingId: 'listing-1', quantity: 2 }],
    };

    const result = await completePosSale(requestPayload, 'key-123');

    expect(result.id).toBe('sale-123');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/merchant/pos/sales',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'key-123',
        },
        body: JSON.stringify(requestPayload),
      }),
    );
  });

  it('retrieves POS sale by ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'sale-999', totalPaise: 45000 }),
    });

    const result = await getPosSale('sale-999');
    expect(result.id).toBe('sale-999');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/merchant/pos/sales/sale-999');
  });

  it('finds POS sale by Idempotency-Key for recovery', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'sale-recovered', totalPaise: 50000 }),
    });

    const result = await findPosSaleByIdempotencyKey('outlet-1', 'idemp-key-xyz');
    expect(result.id).toBe('sale-recovered');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/merchant/pos/sales/by-key?outletId=outlet-1&idempotencyKey=idemp-key-xyz'),
    );
  });

  it('handles API error with error code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ code: 'LISTING_UNAVAILABLE', message: 'Out of stock' }),
    });

    await expect(getPosSale('non-existent')).rejects.toMatchObject({
      name: 'LISTING_UNAVAILABLE',
      message: 'Out of stock',
    });
  });
});
