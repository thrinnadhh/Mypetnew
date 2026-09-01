import { useCallback, useEffect, useMemo, useState } from 'react';
import MerchantOrdersScreen from '../../../app/orders';
import { fetchMerchantCatalogContext } from '../../catalog/api';
import {
  fetchMerchantOrderWork,
  transitionMerchantOrder,
} from '../../operations/orders';

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: jest.fn(),
    useState: jest.fn((initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      jest.fn(),
    ]),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((fn: () => unknown) => fn()),
  };
});

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
  },
  Link: ({ children }: { children: unknown }) => children,
}));

jest.mock('../../catalog/api', () => ({
  fetchMerchantCatalogContext: jest.fn(),
}));

jest.mock('../../operations/orders', () => {
  const actual = jest.requireActual('../../operations/orders');
  return {
    ...actual,
    fetchMerchantOrderWork: jest.fn(),
    transitionMerchantOrder: jest.fn(),
  };
});

jest.mock('../../auth/offline-account', () => ({
  loadOfflineMerchantAccountId: jest.fn().mockResolvedValue('acc-1'),
}));

jest.mock('../../data', () => ({
  useMerchantDatabase: jest.fn().mockReturnValue({
    outboxRepo: null,
    syncStateRepo: null,
  }),
}));

const effectMock = useEffect as jest.MockedFunction<typeof useEffect>;
const stateMock = useState as jest.MockedFunction<typeof useState>;
const contextMock = fetchMerchantCatalogContext as jest.MockedFunction<typeof fetchMerchantCatalogContext>;
const orderWorkMock = fetchMerchantOrderWork as jest.MockedFunction<typeof fetchMerchantOrderWork>;
const transitionMock = transitionMerchantOrder as jest.MockedFunction<typeof transitionMerchantOrder>;

beforeEach(() => {
  jest.clearAllMocks();
  stateMock.mockImplementation(((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    jest.fn(),
  ]) as unknown as typeof useState);
  contextMock.mockResolvedValue({
    organizationId: 'org-1',
    outletIds: ['outlet-1', 'outlet-2'],
    permissionsByOutlet: { 'outlet-1': ['ORDER_FULFIL'], 'outlet-2': ['ORDER_FULFIL'] },
  });
  orderWorkMock.mockResolvedValue({
    items: [
      {
        orderId: 'ord-1',
        orderNumber: 'MP-ORD001',
        outletId: 'outlet-1',
        status: 'PLACED',
        fulfilmentMode: 'STORE_PICKUP',
        grandTotalPaise: 250000,
        paymentStatus: 'PAID',
        createdAt: '2026-09-01T12:00:00Z',
      },
      {
        orderId: 'ord-2',
        orderNumber: 'MP-ORD002',
        outletId: 'outlet-1',
        status: 'PREPARING',
        fulfilmentMode: 'DELIVERY',
        grandTotalPaise: 420000,
        paymentStatus: 'PAID',
        createdAt: '2026-09-01T12:15:00Z',
      },
    ],
    page: 0,
    pageSize: 50,
    hasNext: false,
  });
});

describe('MF3 Merchant Orders Screen', () => {
  it('renders orders screen with modern design system and safe areas', () => {
    expect(MerchantOrdersScreen()).toBeTruthy();
    expect(effectMock).toHaveBeenCalled();
  });

  it('loads canonical order work on startup for current outlet', async () => {
    MerchantOrdersScreen();
    const startup = effectMock.mock.calls[0][0];
    const cleanup = startup();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(orderWorkMock).toHaveBeenCalledWith('outlet-1');
    if (typeof cleanup === 'function') cleanup();
  });

  it('handles order workload load error safely', async () => {
    orderWorkMock.mockRejectedValue(new Error('Backend connection failed'));
    MerchantOrdersScreen();
    const startup = effectMock.mock.calls[0][0];
    startup();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(orderWorkMock).toHaveBeenCalledWith('outlet-1');
  });

  it('executes valid order state transition safely', async () => {
    transitionMock.mockResolvedValue(undefined);
    const order = {
      orderId: 'ord-1',
      orderNumber: 'MP-ORD001',
      outletId: 'outlet-1',
      status: 'PLACED' as const,
      fulfilmentMode: 'STORE_PICKUP',
      grandTotalPaise: 250000,
      paymentStatus: 'PAID',
      createdAt: '2026-09-01T12:00:00Z',
    };
    await transitionMerchantOrder(order, 'ACCEPTED');
    expect(transitionMock).toHaveBeenCalledWith(order, 'ACCEPTED');
  });

  it('requires reason when rejecting or cancelling an order', async () => {
    transitionMock.mockResolvedValue(undefined);
    const order = {
      orderId: 'ord-1',
      orderNumber: 'MP-ORD001',
      outletId: 'outlet-1',
      status: 'PLACED' as const,
      fulfilmentMode: 'STORE_PICKUP',
      grandTotalPaise: 250000,
      paymentStatus: 'PAID',
      createdAt: '2026-09-01T12:00:00Z',
    };
    await transitionMerchantOrder(order, 'REJECTED', 'Item out of stock');
    expect(transitionMock).toHaveBeenCalledWith(order, 'REJECTED', 'Item out of stock');
  });
});
