import { ApiError } from '../../contracts/api-error';
import { fetchCheckoutQuote } from '../customer-orders';

const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Conflict',
    headers: { get: jest.fn().mockReturnValue(null) },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

const request = {
  customerId: '77777777-7777-4777-8777-777777777777',
  providerId: '11111111-1111-4111-8111-111111111111',
  deliveryAddressId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  items: [{ offeringId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
  couponCode: 'CLIENT_ONLY',
  paymentMethod: 'UPI',
};

function canonicalQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    customerId: request.customerId,
    outletId: request.providerId,
    lines: { '22222222-2222-4222-8222-222222222222': [2, 49900] },
    cartSignature: 'signed-cart',
    fulfilmentMode: 'STORE_PICKUP',
    paymentMethod: 'PAY_ON_FULFILMENT',
    pricing: {
      itemSubtotalPaise: 99800,
      itemDiscountPaise: 0,
      couponDiscountPaise: 0,
      loyaltyRewardPaise: 0,
      taxPaise: 0,
      platformFeePaise: 1000,
      deliveryFeePaise: 0,
      merchantCommissionPaise: 1000,
      grandTotalPaise: 100800,
      currency: 'INR',
      ruleVersion: 's1-v1',
    },
    expiresAt: '2026-08-13T01:05:00Z',
    ...overrides,
  };
}

describe('T2C canonical customer pickup quote', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('requires authentication before requesting a quote', async () => {
    await expect(fetchCheckoutQuote(request)).rejects.toThrow('Sign in before requesting a checkout quote.');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('sends only canonical outlet and listing-line fields and preserves server pricing', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse(canonicalQuote()));

    const quote = await fetchCheckoutQuote(request, 'token');

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/customer/quotes/pickup');
    expect(JSON.parse(mockedFetch.mock.calls[0][1]?.body as string)).toEqual({
      outletId: request.providerId,
      lines: [{ listingId: request.items[0].offeringId, quantity: 2 }],
    });
    expect(quote).toMatchObject({
      quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cartSignature: 'signed-cart',
      fulfilmentMode: 'STORE_PICKUP',
      paymentMethod: 'PAY_ON_FULFILMENT',
      subtotal: 998,
      platformFee: 10,
      deliveryFee: 0,
      payableTotal: 1008,
      currency: 'INR',
      ruleVersion: 's1-v1',
    });
  });

  it.each([
    [{ fulfilmentMode: 'DELIVERY' }, 'unsupported Sprint-1 fulfilment contract'],
    [{ paymentMethod: 'CARD' }, 'unsupported Sprint-1 fulfilment contract'],
    [{ pricing: { ...canonicalQuote().pricing, currency: 'USD' } }, 'unsupported currency'],
  ])('fails closed for an incompatible server contract', async (override, expectedMessage) => {
    mockedFetch.mockResolvedValueOnce(jsonResponse(canonicalQuote(override)));
    await expect(fetchCheckoutQuote(request, 'token')).rejects.toThrow(expectedMessage);
  });

  it('preserves stable backend ApiError codes', async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({ code: 'LISTING_UNAVAILABLE', message: 'A cart item is unavailable', fieldErrors: {} }, 409),
    );

    try {
      await fetchCheckoutQuote(request, 'token');
      throw new Error('Expected fetchCheckoutQuote to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409, code: 'LISTING_UNAVAILABLE' });
    }
  });
});
