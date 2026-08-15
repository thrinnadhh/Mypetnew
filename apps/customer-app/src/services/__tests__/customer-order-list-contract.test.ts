import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchCustomerOrderPage } from '@/services/customer-order-list';

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

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const summary = {
  orderId: '99999999-9999-4999-8999-999999999999',
  outlet: { id: '11111111-1111-4111-8111-111111111111', name: 'Happy Pets Tirupati' },
  itemCount: 2,
  grandTotalPaise: 13500,
  fulfilmentMode: 'STORE_PICKUP',
  paymentMethod: 'PAY_ON_FULFILMENT',
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
  status: 'PLACED',
  placedAt: '2026-08-15T00:00:00Z',
  lastUpdatedAt: '2026-08-15T00:00:01Z',
};

describe('canonical Customer order list contract', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('uses the authenticated customer-owned paged endpoint and maps server totals', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, {
      items: [summary],
      page: 0,
      pageSize: 20,
      hasNext: false,
    }));

    const result = await fetchCustomerOrderPage('token', 0, 20);

    expect(result.items[0]).toMatchObject({
      providerName: 'Happy Pets Tirupati',
      itemCount: 2,
      rawTotal: 135,
      total: '₹135',
      status: 'PLACED',
      fulfilmentMode: 'STORE_PICKUP',
    });
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/customer/orders?page=0&pageSize=20');
    expect(url).not.toContain('/api/v1/orders/customer/');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('renders Captain-delivery orders instead of rejecting the P4 fulfilment mode', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, {
      items: [{ ...summary, fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY' }],
      page: 0,
      pageSize: 20,
      hasNext: false,
    }));

    const result = await fetchCustomerOrderPage('token');
    expect(result.items[0].fulfilmentMode).toBe('MYPET_CAPTAIN_DELIVERY');
  });

  it('supports a server-side status filter without sending a customer id', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, { items: [], page: 1, pageSize: 10, hasNext: false }));
    await fetchCustomerOrderPage('token', 1, 10, 'DELIVERED');

    const [url] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('status=DELIVERED');
    expect(url).not.toContain('customerId');
  });

  it('fails closed on invalid pagination pricing and unknown fulfilment modes', async () => {
    mockedFetch.mockResolvedValueOnce(response(200, { items: [], page: -1, pageSize: 20, hasNext: false }));
    await expect(fetchCustomerOrderPage('token')).rejects.toThrow('invalid page');

    mockedFetch.mockResolvedValueOnce(response(200, {
      items: [{ ...summary, grandTotalPaise: -1 }],
      page: 0,
      pageSize: 20,
      hasNext: false,
    }));
    await expect(fetchCustomerOrderPage('token')).rejects.toThrow('invalid server pricing');

    mockedFetch.mockResolvedValueOnce(response(200, {
      items: [{ ...summary, fulfilmentMode: 'COURIER' }],
      page: 0,
      pageSize: 20,
      hasNext: false,
    }));
    await expect(fetchCustomerOrderPage('token')).rejects.toThrow('unsupported canonical order contract');
  });

  it('keeps the active Orders hook off every legacy order service path', () => {
    const hook = source('src/hooks/use-orders.ts');
    const screen = source('src/screens/orders-screen.tsx');

    expect(hook).toContain("from '@/services/customer-order-list'");
    expect(hook).toContain("from '@/services/customer-order-detail'");
    expect(hook).not.toContain("from '@/services/customer-orders'");
    expect(hook).not.toContain('/api/v1/orders/');
    expect(screen).not.toContain('Reorder');
    expect(screen).not.toContain('Subscriptions');
  });
});
