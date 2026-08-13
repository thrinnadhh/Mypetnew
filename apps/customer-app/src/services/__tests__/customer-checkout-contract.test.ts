import { createPickupOrder } from '@/services/customer-checkout';

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

describe('T2D canonical pickup order contract', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('uses canonical endpoint, exact body and stable idempotency key', async () => {
    const response = {
      id: '99999999-9999-4999-8999-999999999999',
      customerId: '77777777-7777-4777-8777-777777777777',
      outletId: '11111111-1111-4111-8111-111111111111',
      quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      grandTotalPaise: 50900,
      platformFeePaise: 1000,
      paymentMethod: 'PAY_ON_FULFILMENT',
      paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
      fulfilmentMode: 'STORE_PICKUP',
      status: 'PLACED',
    };
    mockedFetch.mockResolvedValueOnce(jsonResponse(response));

    const order = await createPickupOrder({ quoteId: response.quoteId, cartSignature: 'signed-cart' }, 'token');
    expect(order.id).toBe(response.id);
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/customer/orders');
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: response.quoteId, cartSignature: 'signed-cart' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Idempotency-Key': `checkout:${response.quoteId}`,
    });
  });

  it('fails closed for non-Sprint-1 fulfilment', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      id: '99999999-9999-4999-8999-999999999999',
      customerId: '77777777-7777-4777-8777-777777777777',
      outletId: '11111111-1111-4111-8111-111111111111',
      quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      grandTotalPaise: 50900,
      platformFeePaise: 1000,
      paymentMethod: 'PAY_ON_FULFILMENT',
      paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
      fulfilmentMode: 'DELIVERY',
      status: 'PLACED',
    }));

    await expect(createPickupOrder({ quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cartSignature: 'signed-cart' }, 'token'))
      .rejects.toThrow('unsupported Sprint-1 checkout contract');
  });
});
