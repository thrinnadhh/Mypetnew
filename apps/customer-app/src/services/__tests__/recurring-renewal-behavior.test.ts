import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RenewalProposal } from '@/contracts/recurring-orders';
import { apiClient } from '@/services/api-client';
import {
  clearRecurringCheckoutHandoff,
  completeRecurringHandoff,
  loadRecurringCheckoutHandoff,
  saveRecurringCheckoutHandoff,
} from '@/services/recurring-handoff';
import {
  confirmRecurringProposal,
  createRecurringOrder,
  fetchRenewalProposals,
  updateRecurringOrder,
} from '@/services/recurring-orders';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
    environment: 'test',
  },
}));

jest.mock('@/services/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const subscription = {
  subscriptionId: 'sub-1',
  customerId: 'customer-a',
  providerId: 'provider-1',
  sourceOrderId: 'order-1',
  deliveryAddressId: null,
  fulfilmentMode: 'STORE_PICKUP' as const,
  cadenceDays: 15 as const,
  quantityMultiplier: 2,
  status: 'ACTIVE' as const,
  nextOrderAt: '2026-09-03T00:00:00Z',
  lastRemindedAt: null,
  timeZone: 'Asia/Kolkata',
  version: 3,
  createdAt: '2026-08-19T00:00:00Z',
  updatedAt: '2026-08-19T00:00:00Z',
};

const proposal: RenewalProposal = {
  proposalId: 'proposal-1',
  subscriptionId: 'sub-1',
  providerId: 'provider-1',
  sourceOrderId: 'order-1',
  deliveryAddressId: null,
  fulfilmentMode: 'STORE_PICKUP',
  cadenceDays: 15,
  quantityMultiplier: 2,
  dueCycleAt: '2026-09-03T00:00:00Z',
  status: 'AWAITING_CONFIRMATION',
  expiresAt: '2026-09-06T00:00:00Z',
  revalidatedAt: null,
  confirmedAt: null,
  orderId: null,
  failureReason: null,
  version: 0,
  createdAt: '2026-09-03T00:00:00Z',
  updatedAt: '2026-09-03T00:00:00Z',
};

describe('P14 recurring renewal behavior', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
    await AsyncStorage.clear();
  });

  it('sends explicit idempotency keys for create and mutation commands', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse(subscription, 201))
      .mockResolvedValueOnce(jsonResponse({ ...subscription, status: 'PAUSED', version: 4 }));

    await createRecurringOrder('order-1', 15, 2, 'token-a', 'create-key-1');
    await updateRecurringOrder('sub-1', 'PAUSE', 'token-a', 'pause-key-1');

    expect(mockedFetch.mock.calls[0][0]).toBe('https://api.mypet.test/api/v1/customer/recurring-orders');
    expect(mockedFetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-a',
        'Idempotency-Key': 'create-key-1',
      }),
    });
    expect(JSON.parse(mockedFetch.mock.calls[0][1]?.body as string)).toEqual({
      sourceOrderId: 'order-1',
      cadenceDays: 15,
      quantityMultiplier: 2,
    });
    expect(mockedFetch.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'Idempotency-Key': 'pause-key-1' }),
    });
  });

  it('paginates proposal history deterministically and de-duplicates by proposal id', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({
        items: [proposal],
        page: 0,
        pageSize: 20,
        hasNext: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [proposal, { ...proposal, proposalId: 'proposal-2', status: 'EXPIRED' }],
        page: 1,
        pageSize: 20,
        hasNext: false,
      }));

    const result = await fetchRenewalProposals('token-a');

    expect(result.map((item) => item.proposalId)).toEqual(['proposal-1', 'proposal-2']);
    expect(mockedFetch.mock.calls.map((call) => call[0])).toEqual([
      'https://api.mypet.test/api/v1/customer/recurring-orders/proposals',
      'https://api.mypet.test/api/v1/customer/recurring-orders/proposals?page=1&pageSize=20',
    ]);
  });

  it('confirms an explicit proposal and preserves integer-paise revalidation data', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      subscription,
      proposal: { ...proposal, status: 'CONFIRMED' },
      reorder: {
        originalOrderId: 'order-1',
        providerId: 'provider-1',
        isProviderServiceable: true,
        canReorder: true,
        items: [{
          offeringId: 'listing-1',
          offeringName: 'Dog Food',
          unitPricePaise: 12_345,
          quantity: 2,
          isAvailable: true,
          message: null,
        }],
      },
      createdOrderId: null,
    }));

    const result = await confirmRecurringProposal('sub-1', 'proposal-1', 'token-a', 'confirm-key-1');

    expect(result.reorder.items[0].unitPricePaise).toBe(12_345);
    expect(mockedFetch.mock.calls[0][0]).toBe(
      'https://api.mypet.test/api/v1/customer/recurring-orders/sub-1/proposals/proposal-1/confirm',
    );
    expect(mockedFetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': 'confirm-key-1' }),
    });
    expect(JSON.stringify(result)).not.toContain('unitPrice":');
  });

  it('keeps checkout handoff strictly account-scoped', async () => {
    await saveRecurringCheckoutHandoff({
      customerId: 'customer-a',
      subscriptionId: 'sub-1',
      proposalId: 'proposal-1',
      providerId: 'provider-1',
      fulfilmentMode: 'STORE_PICKUP',
      createdAt: '2026-08-19T00:00:00Z',
    });

    await expect(loadRecurringCheckoutHandoff('customer-a')).resolves.toMatchObject({
      customerId: 'customer-a',
      proposalId: 'proposal-1',
    });
    await expect(loadRecurringCheckoutHandoff('customer-b')).resolves.toBeNull();

    await AsyncStorage.setItem('mypet_recurring_handoff_v1_customer_customer-b', JSON.stringify({
      customerId: 'customer-a',
      subscriptionId: 'sub-foreign',
      proposalId: 'proposal-foreign',
      providerId: 'provider-foreign',
      fulfilmentMode: 'STORE_PICKUP',
      createdAt: '2026-08-19T00:00:00Z',
    }));
    await expect(loadRecurringCheckoutHandoff('customer-b')).resolves.toBeNull();
  });

  it('retains failed completion recovery and clears only after canonical backend success', async () => {
    const handoff = {
      customerId: 'customer-a',
      subscriptionId: 'sub-1',
      proposalId: 'proposal-1',
      providerId: 'provider-1',
      fulfilmentMode: 'STORE_PICKUP' as const,
      orderId: 'order-new',
      checkoutIdempotencyKey: 'checkout:quote-1',
      createdAt: '2026-08-19T00:00:00Z',
    };
    await saveRecurringCheckoutHandoff(handoff);
    mockedApiClient.post.mockRejectedValueOnce(new Error('network'));

    await expect(completeRecurringHandoff(handoff)).rejects.toThrow('network');
    await expect(loadRecurringCheckoutHandoff('customer-a')).resolves.toMatchObject({ orderId: 'order-new' });

    mockedApiClient.post.mockResolvedValueOnce({ ...proposal, status: 'ORDER_CREATED', orderId: 'order-new' });
    await expect(completeRecurringHandoff(handoff)).resolves.toBe(true);
    expect(mockedApiClient.post).toHaveBeenLastCalledWith(
      '/api/v1/customer/recurring-orders/sub-1/proposals/proposal-1/complete',
      { orderId: 'order-new' },
      { 'Idempotency-Key': 'checkout:quote-1' },
    );
    await expect(loadRecurringCheckoutHandoff('customer-a')).resolves.toBeNull();
  });

  it('can explicitly clear only the current customer handoff', async () => {
    await saveRecurringCheckoutHandoff({
      customerId: 'customer-a', subscriptionId: 'sub-a', proposalId: 'prop-a', providerId: 'provider-a',
      fulfilmentMode: 'STORE_PICKUP', createdAt: '2026-08-19T00:00:00Z',
    });
    await saveRecurringCheckoutHandoff({
      customerId: 'customer-b', subscriptionId: 'sub-b', proposalId: 'prop-b', providerId: 'provider-b',
      fulfilmentMode: 'STORE_PICKUP', createdAt: '2026-08-19T00:00:00Z',
    });

    await clearRecurringCheckoutHandoff('customer-a');

    await expect(loadRecurringCheckoutHandoff('customer-a')).resolves.toBeNull();
    await expect(loadRecurringCheckoutHandoff('customer-b')).resolves.toMatchObject({ proposalId: 'prop-b' });
  });
});
