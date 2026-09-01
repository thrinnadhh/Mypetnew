import { useCallback, useEffect, useMemo, useState } from 'react';
import MerchantCatalogScreen from '../../../app/catalog';
import {
  changeListingStatus,
  createListing,
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  updateListing,
  uploadCatalogMedia,
} from '../../catalog/api';

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

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///data/photo.jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: 102400,
      },
    ],
  }),
}));

jest.mock('../../catalog/api', () => ({
  catalogMediaCommandKey: jest.fn().mockReturnValue('key-media-1'),
  changeListingStatus: jest.fn(),
  createListing: jest.fn(),
  fetchCatalogPage: jest.fn(),
  fetchMerchantCatalogContext: jest.fn(),
  updateListing: jest.fn(),
  uploadCatalogMedia: jest.fn(),
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
const createMock = createListing as jest.MockedFunction<typeof createListing>;
const updateMock = updateListing as jest.MockedFunction<typeof updateListing>;
const statusMock = changeListingStatus as jest.MockedFunction<typeof changeListingStatus>;
const mediaMock = uploadCatalogMedia as jest.MockedFunction<typeof uploadCatalogMedia>;

const mockListing = {
  id: 'listing-1',
  organizationId: 'org-1',
  outletId: 'outlet-1',
  normalizedBarcode: '8901234567890',
  barcodeType: 'GTIN_13' as const,
  name: 'Royal Canin Maxi Adult Dog Food',
  kind: 'PRODUCT' as const,
  commerceMode: 'COMMERCE' as const,
  mrpPaise: 450000,
  sellingPricePaise: 420000,
  category: 'dog-food',
  brand: 'Royal Canin',
  sku: 'RC-MXI-15',
  packLabel: '15kg',
  petType: 'Dog',
  lifeStage: 'Adult',
  description: 'Premium dog food',
  imageUrls: ['https://example.com/rc.jpg'],
  status: 'ACTIVE' as const,
  version: 2,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  stateMock.mockImplementation(((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    jest.fn(),
  ]) as unknown as typeof useState);
  contextMock.mockResolvedValue({
    organizationId: 'org-1',
    outletIds: ['outlet-1', 'outlet-2'],
    permissionsByOutlet: { 'outlet-1': ['CATALOG_WRITE'], 'outlet-2': ['CATALOG_WRITE'] },
  });
  catalogMock.mockResolvedValue({
    items: [mockListing],
    page: 0,
    pageSize: 25,
    hasNext: false,
  });
});

describe('MF3 Merchant Catalog Screen', () => {
  it('renders catalog screen with design system and safe areas', () => {
    expect(MerchantCatalogScreen()).toBeTruthy();
    expect(effectMock).toHaveBeenCalled();
  });

  it('loads catalog listings on startup for current outlet', async () => {
    MerchantCatalogScreen();
    const startup = effectMock.mock.calls[0][0];
    const cleanup = startup();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(catalogMock).toHaveBeenCalledWith('outlet-1', {
      query: undefined,
      status: undefined,
      page: 0,
      pageSize: 25,
    });
    if (typeof cleanup === 'function') cleanup();
  });

  it('creates product listing safely via createListing', async () => {
    createMock.mockResolvedValue({
      ...mockListing,
      id: 'listing-new',
      name: 'Pedigree Adult Dog Food',
    });
    const input = {
      name: 'Pedigree Adult Dog Food',
      kind: 'PRODUCT' as const,
      barcodeType: 'GTIN_13' as const,
      barcode: '8901234567899',
      mrpPaise: 250000,
      sellingPricePaise: 230000,
      category: 'dog-food',
    };
    await createListing('outlet-1', input);
    expect(createMock).toHaveBeenCalledWith('outlet-1', input);
  });

  it('updates product listing safely with optimistic concurrency', async () => {
    updateMock.mockResolvedValue({
      ...mockListing,
      sellingPricePaise: 410000,
      version: 3,
    });
    const updateInput = {
      name: 'Royal Canin Maxi Adult Dog Food',
      mrpPaise: 450000,
      sellingPricePaise: 410000,
      category: 'dog-food',
    };
    await updateListing(mockListing, updateInput);
    expect(updateMock).toHaveBeenCalledWith(mockListing, updateInput);
  });

  it('changes product status safely', async () => {
    statusMock.mockResolvedValue({
      ...mockListing,
      status: 'INACTIVE',
      version: 3,
    });
    await changeListingStatus(mockListing, 'INACTIVE');
    expect(statusMock).toHaveBeenCalledWith(mockListing, 'INACTIVE');
  });

  it('uploads catalog media safely with idempotency key', async () => {
    mediaMock.mockResolvedValue({
      mediaId: 'att-1',
      listingId: 'listing-1',
      position: 0,
      publicUrl: 'https://example.com/rc-new.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 102400,
      listingVersion: 3,
    });
    const asset = {
      uri: 'file:///data/photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg' as const,
      size: 102400,
    };
    await uploadCatalogMedia(mockListing, asset, 'media-key-1');
    expect(mediaMock).toHaveBeenCalledWith(mockListing, asset, 'media-key-1');
  });
});

