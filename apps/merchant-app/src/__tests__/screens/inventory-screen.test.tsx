import { useEffect, useState } from 'react';
import MerchantInventoryScreen from '../../../app/inventory';
import { fetchCatalogPage, fetchMerchantCatalogContext } from '../../catalog/api';
import { fetchInventoryBalance, fetchInventoryMovements } from '../../inventory/api';

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: jest.fn(),
    useState: jest.fn((initial: unknown) => [initial, jest.fn()]),
  };
});

jest.mock('../../catalog/api', () => ({
  fetchCatalogPage: jest.fn(),
  fetchMerchantCatalogContext: jest.fn(),
}));

jest.mock('../../inventory/api', () => ({
  createInventoryAdjustmentCommand: jest.fn(),
  fetchInventoryBalance: jest.fn(),
  fetchInventoryMovements: jest.fn(),
  submitInventoryAdjustment: jest.fn(),
}));

const effectMock = useEffect as jest.MockedFunction<typeof useEffect>;
const stateMock = useState as jest.MockedFunction<typeof useState>;
const contextMock = fetchMerchantCatalogContext as jest.MockedFunction<typeof fetchMerchantCatalogContext>;
const catalogMock = fetchCatalogPage as jest.MockedFunction<typeof fetchCatalogPage>;
const balanceMock = fetchInventoryBalance as jest.MockedFunction<typeof fetchInventoryBalance>;
const movementMock = fetchInventoryMovements as jest.MockedFunction<typeof fetchInventoryMovements>;

beforeEach(() => {
  jest.clearAllMocks();
  stateMock.mockImplementation(((initial: unknown) => [initial, jest.fn()]) as unknown as typeof useState);
  contextMock.mockResolvedValue({
    organizationId: 'org-1',
    outletIds: ['outlet-1'],
    permissionsByOutlet: { 'outlet-1': ['INVENTORY_WRITE'] },
  });
  catalogMock.mockResolvedValue({
    items: [{ id: 'listing-1', name: 'Dog food' } as never],
    page: 0,
    pageSize: 1,
    hasNext: false,
  });
  balanceMock.mockResolvedValue({
    organizationId: 'org-1',
    outletId: 'outlet-1',
    listingId: 'listing-1',
    onHand: 4,
    reserved: 1,
    available: 3,
    version: 2,
    updatedAt: '2026-08-22T00:00:00Z',
  });
  movementMock.mockResolvedValue({ items: [], page: 0, pageSize: 25, hasNext: false });
});

describe('Merchant M3 inventory screen', () => {
  it('renders the initial safe state and starts from current Merchant context', async () => {
    expect(MerchantInventoryScreen()).toBeTruthy();
    expect(effectMock).toHaveBeenCalledTimes(1);

    const startup = effectMock.mock.calls[0][0];
    const cleanup = startup();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(catalogMock).toHaveBeenCalledWith('outlet-1', { pageSize: 1 });
    expect(balanceMock).toHaveBeenCalledWith('outlet-1', 'listing-1');
    expect(movementMock).toHaveBeenCalledWith('outlet-1', 'listing-1', 0, 25);
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
});
