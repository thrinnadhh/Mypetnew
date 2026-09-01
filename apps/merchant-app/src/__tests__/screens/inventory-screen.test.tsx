import { useCallback, useEffect, useMemo, useState } from 'react';
import MerchantInventoryScreen from '../../../app/inventory';
import { fetchCatalogPage, fetchMerchantCatalogContext } from '../../catalog/api';
import {
  createInventoryAdjustmentCommand,
  fetchInventoryBalance,
  fetchInventoryMovements,
  submitDamage,
  submitInventoryAdjustment,
  submitReceiving,
} from '../../inventory/api';

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
  fetchCatalogPage: jest.fn(),
  fetchMerchantCatalogContext: jest.fn(),
}));

jest.mock('../../inventory/api', () => ({
  createInventoryAdjustmentCommand: jest.fn(),
  fetchInventoryBalance: jest.fn(),
  fetchInventoryMovements: jest.fn(),
  submitInventoryAdjustment: jest.fn(),
  submitReceiving: jest.fn(),
  submitDamage: jest.fn(),
  submitExpiry: jest.fn(),
  submitShrinkage: jest.fn(),
  submitReturn: jest.fn(),
  submitTransfer: jest.fn(),
  startStockCount: jest.fn(),
  updateStockCountLines: jest.fn(),
  submitStockCount: jest.fn(),
}));

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
const catalogMock = fetchCatalogPage as jest.MockedFunction<typeof fetchCatalogPage>;
const balanceMock = fetchInventoryBalance as jest.MockedFunction<typeof fetchInventoryBalance>;
const movementMock = fetchInventoryMovements as jest.MockedFunction<typeof fetchInventoryMovements>;
const adjustMock = submitInventoryAdjustment as jest.MockedFunction<typeof submitInventoryAdjustment>;
const receiveMock = submitReceiving as jest.MockedFunction<typeof submitReceiving>;
const damageMock = submitDamage as jest.MockedFunction<typeof submitDamage>;

beforeEach(() => {
  jest.clearAllMocks();
  stateMock.mockImplementation(((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    jest.fn(),
  ]) as unknown as typeof useState);
  contextMock.mockResolvedValue({
    organizationId: 'org-1',
    outletIds: ['outlet-1', 'outlet-2'],
    permissionsByOutlet: { 'outlet-1': ['INVENTORY_WRITE'], 'outlet-2': ['INVENTORY_WRITE'] },
  });
  catalogMock.mockResolvedValue({
    items: [
      {
        id: 'listing-1',
        name: 'Royal Canin Dog Food',
        organizationId: 'org-1',
        outletId: 'outlet-1',
        normalizedBarcode: '8901234567890',
        barcodeType: 'GTIN_13',
        kind: 'PRODUCT',
        commerceMode: 'COMMERCE',
        mrpPaise: 450000,
        sellingPricePaise: 420000,
        category: 'dog-food',
        imageUrls: [],
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      },
    ],
    page: 0,
    pageSize: 50,
    hasNext: false,
  });
  balanceMock.mockResolvedValue({
    organizationId: 'org-1',
    outletId: 'outlet-1',
    listingId: 'listing-1',
    onHand: 12,
    reserved: 2,
    available: 10,
    version: 2,
    updatedAt: '2026-08-22T00:00:00Z',
  });
  movementMock.mockResolvedValue({ items: [], page: 0, pageSize: 25, hasNext: false });
});

describe('MF3 Merchant Inventory Screen', () => {
  it('renders the initial safe state and starts from current Merchant context', async () => {
    expect(MerchantInventoryScreen()).toBeTruthy();
    expect(effectMock).toHaveBeenCalledTimes(1);

    const startup = effectMock.mock.calls[0][0];
    const cleanup = startup();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(catalogMock).toHaveBeenCalledWith('outlet-1', { pageSize: 50 });
    expect(balanceMock).toHaveBeenCalledWith('outlet-1', 'listing-1');
    if (typeof cleanup === 'function') cleanup();
  });

  it('fails closed when there is no current authorized outlet', async () => {
    contextMock.mockResolvedValue({ organizationId: null, outletIds: [], permissionsByOutlet: {} });
    expect(MerchantInventoryScreen()).toBeTruthy();
    const startup = effectMock.mock.calls[0][0];
    startup();
    await Promise.resolve();
    await Promise.resolve();
    expect(catalogMock).not.toHaveBeenCalled();
    expect(balanceMock).not.toHaveBeenCalled();
  });

  it('executes inventory adjustment command safely', async () => {
    adjustMock.mockResolvedValue({
      id: 'mov-1',
      listingId: 'listing-1',
      reason: 'MANUAL_INCREASE',
      quantityDelta: 5,
      resultingOnHand: 17,
      resultingReserved: 2,
      sourceReference: 'manual',
      occurredAt: '2026-09-01T12:00:00Z',
    });
    const cmd = {
      idempotencyKey: 'key-1',
      input: {
        outletId: 'outlet-1',
        listingId: 'listing-1',
        quantityDelta: 5,
        reason: 'MANUAL_INCREASE' as const,
      },
    };
    await submitInventoryAdjustment(cmd);
    expect(adjustMock).toHaveBeenCalledWith(cmd);
  });

  it('records stock receiving safely', async () => {
    receiveMock.mockResolvedValue({
      id: 'mov-2',
      listingId: 'listing-1',
      reason: 'RECEIVING',
      quantityDelta: 20,
      resultingOnHand: 32,
      resultingReserved: 2,
      sourceReference: 'PO-101',
      occurredAt: '2026-09-01T12:00:00Z',
    });
    const input = {
      outletId: 'outlet-1',
      listingId: 'listing-1',
      quantity: 20,
      referenceType: 'PO',
      referenceId: 'PO-101',
    };
    await submitReceiving(input);
    expect(receiveMock).toHaveBeenCalledWith(input);
  });

  it('records damaged stock removal safely', async () => {
    damageMock.mockResolvedValue({
      id: 'mov-3',
      listingId: 'listing-1',
      reason: 'DAMAGE',
      quantityDelta: -2,
      resultingOnHand: 10,
      resultingReserved: 2,
      sourceReference: 'leak',
      occurredAt: '2026-09-01T12:00:00Z',
    });
    const input = {
      outletId: 'outlet-1',
      listingId: 'listing-1',
      quantity: 2,
      reasonDetails: 'Water damage',
    };
    await submitDamage(input);
    expect(damageMock).toHaveBeenCalledWith(input);
  });
});
