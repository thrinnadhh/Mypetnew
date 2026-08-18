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
  outlet: { id: '11111111-1111-4111-8111-111111111111', name: 'Outlet One' },
  items: [{
    listingId: '33333333-3333-4333-8333-333333333333',
    name: 'Dog Food at checkout',
    quantity: 2,
    unitPricePaise: 25_000,
    lineTotalPaise: 50_000,
  }],
  pricing: {
    itemSubtotalPaise: 50_000,
    itemDiscountPaise: 1_000,
    couponDiscountPaise: 2_000,
    loyaltyRewardPaise: 500,
    taxPaise: 1_500,
    platformFeePaise: 1_000,
    deliveryFeePaise: 0,
    grandTotalPaise: 49_000,
    currency: 'INR',
  },
  paymentMethod: 'PAY_ON_FULFILMENT',
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
  fulfilmentMode: 'STORE_PICKUP',
  status: 'PLACED',
  placedAt: '2026-08-13T00:00:00Z',
  statusHistory: [{ fromStatus: null, toStatus: 'PLACED', changedAt: '2026-08-13T00:00:00Z', reason: null }],
  deliveryAddress: null,
  canCancel: true,
  cancellation: { cancelled: false, reason: null, cancelledAt: null },
} as const;

describe('canonical Customer order detail contract', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('reads customer-owned pickup detail with immutable line and complete persisted pricing', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, order));
    const result = await fetchCustomerOrderDetail(order.orderId, 'token');
    expect(result.statusHistory).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Dog Food at checkout', unitPricePaise: 25_000, lineTotalPaise: 50_000 });
    expect(result.pricing).toMatchObject({
      itemSubtotalPaise: 50_000,
      itemDiscountPaise: 1_000,
      couponDiscountPaise: 2_000,
      loyaltyRewardPaise: 500,
      taxPaise: 1_500,
      platformFeePaise: 1_000,
      deliveryFeePaise: 0,
      grandTotalPaise: 49_000,
    });
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/customer/orders/${order.orderId}`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('accepts canonical Captain delivery and online payment', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, {
      ...order,
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
      paymentMethod: 'ONLINE_PAYMENT',
      paymentStatus: 'PAID',
      deliveryAddress: {
        addressId: '44444444-4444-4444-8444-444444444444',
        recipientName: 'Customer',
        phoneNumber: '+919999999999',
        line1: '1 Main Road',
        line2: null,
        city: 'Tirupati',
        state: 'Andhra Pradesh',
        pincode: '517501',
      },
    }));
    const result = await fetchCustomerOrderDetail(order.orderId, 'token');
    expect(result.fulfilmentMode).toBe('MYPET_CAPTAIN_DELIVERY');
    expect(result.paymentMethod).toBe('ONLINE_PAYMENT');
  });

  it('cancels with an intent-bound replay key', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, {
      ...order,
      status: 'CANCELLED',
      canCancel: false,
      cancellation: { cancelled: true, reason: 'Changed my mind', cancelledAt: '2026-08-13T00:01:00Z' },
    }));
    const result = await cancelCustomerOrder(order.orderId, 'Changed my mind', 'token');
    expect(result.status).toBe('CANCELLED');
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/customer/orders/${order.orderId}/cancel`);
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Changed my mind' });
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      new RegExp(`^customer-cancel:${order.orderId}:[0-9a-f]+$`),
    );
  });

  it('fails closed on a rewritten line total', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, {
      ...order,
      items: [{ ...order.items[0], lineTotalPaise: 1 }],
    }));
    await expect(fetchCustomerOrderDetail(order.orderId, 'token')).rejects.toThrow('invalid historical order items');
  });

  it('fails closed on incomplete or invalid historical pricing', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, {
      ...order,
      pricing: { ...order.pricing, taxPaise: -1 },
    }));
    await expect(fetchCustomerOrderDetail(order.orderId, 'token')).rejects.toThrow('invalid server pricing');
  });

  it('still fails closed if the server returns an unknown fulfilment mode', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, { ...order, fulfilmentMode: 'DELIVERY' }));
    await expect(fetchCustomerOrderDetail(order.orderId, 'token')).rejects.toThrow('unsupported canonical order contract');
  });
});
