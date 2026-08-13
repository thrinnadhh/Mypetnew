import { cancelCustomerOrder, fetchCustomerOrderDetail } from '@/services/customer-order-detail';

const mockedFetch = jest.fn();

function response(status = 200, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: { get: jest.fn().mockReturnValue(null) },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

const order = {
  orderId: '99999999-9999-4999-8999-999999999999',
  orderNumber: 'MP-99999999',
  outletId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  outletName: 'Outlet One',
  items: [{ listingId: '33333333-3333-4333-8333-333333333333', name: 'Dog Food', quantity: 2 }],
  grandTotalPaise: 50900,
  platformFeePaise: 1000,
  paymentMethod: 'PAY_ON_FULFILMENT',
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
  fulfilmentMode: 'STORE_PICKUP',
  status: 'PLACED',
  placedAt: '2026-08-13T00:00:00Z',
  statusHistory: [{ fromStatus: null, toStatus: 'PLACED', changedAt: '2026-08-13T00:00:00Z', reason: null }],
};

describe('T2E canonical customer order detail contract', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('reads customer-owned detail from the canonical route', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, order));
    const result = await fetchCustomerOrderDetail(order.orderId, 'token');
    expect(result.statusHistory).toHaveLength(1);
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/customer/orders/${order.orderId}`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('cancels through the customer-owned endpoint with an idempotency key', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, { ...order, status: 'CANCELLED' }));
    const result = await cancelCustomerOrder(order.orderId, 'Changed my mind', 'token');
    expect(result.status).toBe('CANCELLED');
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/customer/orders/${order.orderId}/cancel`);
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Changed my mind' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token',
      'Idempotency-Key': `customer-cancel:${order.orderId}`,
    });
  });

  it('fails closed if the server returns a later-sprint fulfilment mode', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, { ...order, fulfilmentMode: 'DELIVERY' }));
    await expect(fetchCustomerOrderDetail(order.orderId, 'token')).rejects.toThrow('unsupported Sprint-1 order contract');
  });
});
