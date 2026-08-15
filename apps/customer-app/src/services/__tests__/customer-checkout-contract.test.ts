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
  status: 'PLACED',
};

describe('canonical product order contract', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('uses canonical endpoint, exact body and stable idempotency key for pickup', async () => {
    const response = { ...baseResponse, fulfilmentMode: 'STORE_PICKUP' };
    mockedFetch.mockResolvedValueOnce(jsonResponse(response));

    const order = await createPickupOrder({ quoteId: response.quoteId, cartSignature: 'signed-cart' }, 'token');
    expect(order.id).toBe(response.id);
    expect(order.fulfilmentMode).toBe('STORE_PICKUP');
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
      'token',
    );

    expect(order.fulfilmentMode).toBe('MYPET_CAPTAIN_DELIVERY');
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/customer/orders');
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: response.quoteId, cartSignature: 'signed-cart' });
  });

  it('fails closed when the server returns a different fulfilment mode than the quote flow expects', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      ...baseResponse,
      fulfilmentMode: 'UNSUPPORTED_MODE',
    }));

    await expect(createProductOrder(
      { quoteId: baseResponse.quoteId, cartSignature: 'signed-cart' },
      'MYPET_CAPTAIN_DELIVERY',
      'token',
    )).rejects.toThrow('unsupported canonical checkout contract');
  });

  it('fails closed when a delivery response is returned to the pickup helper', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      ...baseResponse,
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
    }));

    await expect(createPickupOrder(
      { quoteId: baseResponse.quoteId, cartSignature: 'signed-cart' },
      'token',
    )).rejects.toThrow('unsupported canonical checkout contract');
  });
});
