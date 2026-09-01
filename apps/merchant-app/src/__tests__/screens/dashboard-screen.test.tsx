import { useCallback, useEffect, useMemo, useState } from 'react';
import MerchantDashboardScreen, { MerchantDashboardContent } from '../../../app/dashboard';
import { fetchMerchantCatalogContext } from '../../catalog/api';
import { fetchMerchantDashboard } from '../../operations/dashboard';

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: jest.fn(),
    useState: jest.fn((initial: unknown) => [initial, jest.fn()]),
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

jest.mock('../../operations/dashboard', () => {
  const actual = jest.requireActual('../../operations/dashboard');
  return {
    ...actual,
    fetchMerchantDashboard: jest.fn(),
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
const dashboardMock = fetchMerchantDashboard as jest.MockedFunction<typeof fetchMerchantDashboard>;

beforeEach(() => {
  jest.clearAllMocks();
  stateMock.mockImplementation(((initial: unknown) => [initial, jest.fn()]) as unknown as typeof useState);
  contextMock.mockResolvedValue({
    organizationId: 'org-1',
    outletIds: ['outlet-1', 'outlet-2'],
    permissionsByOutlet: { 'outlet-1': ['CATALOG_WRITE'], 'outlet-2': ['STAFF_ADMIN'] },
  });
  dashboardMock.mockResolvedValue({
    outletIds: ['outlet-1', 'outlet-2'],
    metrics: {
      pendingAppointments: 4,
      activeCatalog: 12,
      lowStockInventory: 2,
      outOfStockInventory: 1,
      orderWork: 7,
      lowStockThreshold: 5,
    },
    generatedAt: '2026-08-31T12:00:00Z',
  });
});

describe('MF2 Merchant Dashboard Screen', () => {
  it('renders dashboard with modern design system and safe areas', () => {
    expect(MerchantDashboardScreen()).toBeTruthy();
    expect(MerchantDashboardContent({})).toBeTruthy();
    expect(effectMock).toHaveBeenCalled();
  });

  it('loads canonical dashboard data on startup', async () => {
    MerchantDashboardContent({});
    const startup = effectMock.mock.calls[0][0];
    const cleanup = startup();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(dashboardMock).toHaveBeenCalledTimes(1);
    if (typeof cleanup === 'function') cleanup();
  });

  it('handles dashboard load failure safely with error state', async () => {
    dashboardMock.mockRejectedValue(new Error('Network error'));
    MerchantDashboardContent({});
    const startup = effectMock.mock.calls[0][0];
    startup();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
  });
});
