import { useCallback, useEffect, useMemo, useState } from 'react';
import MerchantBarcodeScreen from '../../../app/barcode';
import { resolveMerchantBarcode, completePosSale } from '../../barcode/api';
import { fetchMerchantCatalogContext } from '../../catalog/api';
import { fetchInventoryBalance } from '../../inventory/api';

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
    useRef: jest.fn(() => ({ current: null })),
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
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
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

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid-12345'),
}));

jest.mock('../../barcode/api', () => ({
  resolveMerchantBarcode: jest.fn(),
  completePosSale: jest.fn(),
  getPosSale: jest.fn(),
  findPosSaleByIdempotencyKey: jest.fn(),
}));

jest.mock('../../catalog/api', () => ({
  fetchMerchantCatalogContext: jest.fn(),
}));

jest.mock('../../inventory/api', () => ({
  fetchInventoryBalance: jest.fn(),
}));

jest.mock('../../auth/offline-account', () => ({
  loadOfflineMerchantAccountId: jest.fn().mockResolvedValue('acc-1'),
}));

jest.mock('../../auth/session', () => ({
  installationId: jest.fn().mockResolvedValue('inst-1'),
}));

jest.mock('../../data', () => ({
  useMerchantDatabase: jest.fn().mockReturnValue({
    database: null,
    barcodeRepo: null,
    draftRepo: null,
    pendingMediaRepo: null,
  }),
}));

describe('MerchantBarcodeScreen (POS & Barcode Scanner)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchMerchantCatalogContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      outletIds: ['outlet-1', 'outlet-2'],
    });
    (resolveMerchantBarcode as jest.Mock).mockResolvedValue({
      barcodeType: 'GTIN_13',
      normalizedBarcode: '8901234567890',
      listing: {
        id: 'listing-1',
        name: 'Cat Food 1kg',
        mrpPaise: 50000,
        sellingPricePaise: 45000,
        barcodeType: 'GTIN_13',
        normalizedBarcode: '8901234567890',
      },
    });
    (fetchInventoryBalance as jest.Mock).mockResolvedValue({
      available: 12,
      onHand: 12,
      reserved: 0,
    });
    (completePosSale as jest.Mock).mockResolvedValue({
      id: 'sale-999',
      merchantId: 'merch-1',
      outletId: 'outlet-1',
      customerId: null,
      lines: { 'listing-1': { first: 1, second: 45000 } },
      totalPaise: 45000,
      paymentDeclaration: 'CASH',
      completedAt: '2026-09-01T12:00:00Z',
      loyaltyAwarded: false,
    });
  });

  it('renders the complete POS & Barcode Scanner screen without crash', () => {
    const screen = MerchantBarcodeScreen();
    expect(screen).toBeTruthy();
  });
});
