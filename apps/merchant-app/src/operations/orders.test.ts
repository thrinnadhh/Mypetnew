import { merchantApiFetch } from '../auth/session';
import { fetchMerchantOrderWork, orderTargets, transitionMerchantOrder, type MerchantOrderWorkItem } from './orders';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));
const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;
const order: MerchantOrderWorkItem = {
  orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 'M11-1', outletId: 'outlet-1', status: 'PLACED',
  fulfilmentMode: 'STORE_PICKUP', grandTotalPaise: 12500, paymentStatus: 'PENDING_EXTERNAL_COLLECTION', createdAt: '2026-08-31T10:00:00Z',
};
function response(ok: boolean, body: unknown): Response { return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response; }

beforeEach(() => fetchMock.mockReset());

describe('M11 canonical order work', () => {
  it('loads bounded server order work and rejects malformed metrics', async () => {
    fetchMock.mockResolvedValue(response(true, { items: [order], page: 0, pageSize: 50, hasNext: false }));
    await expect(fetchMerchantOrderWork()).resolves.toMatchObject({ items: [order] });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/order-work?page=0&pageSize=50');
    fetchMock.mockResolvedValue(response(true, { items: [{ ...order, grandTotalPaise: '12500' }], page: 0, pageSize: 50, hasNext: false }));
    await expect(fetchMerchantOrderWork()).rejects.toThrow('MERCHANT_ORDER_WORK_INVALID');
  });

  it('derives only backend-valid merchant transitions from current canonical state', () => {
    expect(orderTargets(order)).toEqual(['ACCEPTED', 'REJECTED']);
    expect(orderTargets({ ...order, status: 'READY_FOR_PICKUP', fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY' })).toEqual([]);
    expect(orderTargets({ ...order, status: 'PICKED_UP' })).toEqual(['DELIVERED']);
  });

  it('requires a reason for destructive transitions and sends an idempotency key', async () => {
    await expect(transitionMerchantOrder(order, 'REJECTED')).rejects.toThrow('ORDER_REASON_REQUIRED');
    fetchMock.mockResolvedValue(response(true, {}));
    await transitionMerchantOrder(order, 'REJECTED', 'Unable to fulfil');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/merchant/orders/${order.orderId}/transitions`), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^m11-order:/) }),
      body: JSON.stringify({ target: 'REJECTED', reason: 'Unable to fulfil' }),
    }));
  });
});
