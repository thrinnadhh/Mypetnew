import { apiClient } from '@/services/api-client';
import { createPickupOrder, createProductOrder } from '@/services/customer-checkout';

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

const baseResponse = {
  id: '99999999-9999-4999-8999-999999999999',
  customerId: '77777777-7777-4777-8777-777777777777',
  outletId: '11111111-1111-4111-8111-111111111111',
  quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  grandTotalPaise: 50900,
  platformFeePaise: 1000,
  paymentMethod: 'PAY_ON_FULFILMENT',
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
  paymentHoldExpiresAt: null,
  status: 'PLACED',
};

describe('canonical product order contract', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
    apiClient.setSessionToken('token');
  });

  afterEach(() => {
    apiClient.setSessionToken(null);
  });

  it('uses canonical endpoint, exact body and stable idempotency key for pickup', async () => {
    const response = { ...baseResponse, fulfilmentMode: 'STORE_PICKUP' };
    mockedFetch.mockResolvedValueOnce(jsonResponse(response));

    const order = await createPickupOrder(
      { quoteId: response.quoteId, cartSignature: 'signed-cart' },
      'PAY_ON_FULFILMENT',
    );
    expect(order.id).toBe(response.id);
    expect(order.fulfilmentMode).toBe('STORE_PICKUP');
    expect(order.paymentMethod).toBe('PAY_ON_FULFILMENT');
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/customer/orders');
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: response.quoteId, cartSignature: 'signed-cart' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Idempotency-Key': `checkout:${response.quoteId}`,
    });
  });

  it('uses the same canonical order endpoint for Captain delivery', async () => {
    const response = { ...baseResponse, fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY' };
    mockedFetch.mockResolvedValueOnce(jsonResponse(response));

    const order = await createProductOrder(
      { quoteId: response.quoteId, cartSignature: 'signed-cart' },
      'MYPET_CAPTAIN_DELIVERY',
      'PAY_ON_FULFILMENT',
    );

    expect(order.fulfilmentMode).toBe('MYPET_CAPTAIN_DELIVERY');
    expect(order.paymentStatus).toBe('PENDING_EXTERNAL_COLLECTION');
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/customer/orders');
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: response.quoteId, cartSignature: 'signed-cart' });
  });

  it('accepts a server-created online-payment hold without letting checkout override quote payment method', async () => {
    const response = {
      ...baseResponse,
      fulfilmentMode: 'STORE_PICKUP',
      paymentMethod: 'ONLINE_PAYMENT',
      paymentStatus: 'PENDING_ONLINE_PAYMENT',
      paymentHoldExpiresAt: '2026-08-15T13:00:00Z',
    };
    mockedFetch.mockResolvedValueOnce(jsonResponse(response));

    const order = await createPickupOrder(
      { quoteId: response.quoteId, cartSignature: 'signed-cart' },
      'ONLINE_PAYMENT',
    );

    expect(order.paymentMethod).toBe('ONLINE_PAYMENT');
    expect(order.paymentStatus).toBe('PENDING_ONLINE_PAYMENT');
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: response.quoteId, cartSignature: 'signed-cart' });
    expect(JSON.stringify(JSON.parse(init.body as string))).not.toContain('paymentMethod');
  });

  it('fails closed when the server returns a different fulfilment mode than the quote flow expects', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      ...baseResponse,
      fulfilmentMode: 'UNSUPPORTED_MODE',
    }));

    await expect(createProductOrder(
      { quoteId: baseResponse.quoteId, cartSignature: 'signed-cart' },
      'MYPET_CAPTAIN_DELIVERY',
      'PAY_ON_FULFILMENT',
    )).rejects.toThrow('unsupported canonical checkout contract');
  });

  it('fails closed when a delivery response is returned to the pickup helper', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      ...baseResponse,
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
    }));

    await expect(createPickupOrder(
      { quoteId: baseResponse.quoteId, cartSignature: 'signed-cart' },
      'PAY_ON_FULFILMENT',
    )).rejects.toThrow('unsupported canonical checkout contract');
  });
});
