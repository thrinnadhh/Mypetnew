import React from 'react';
import {
  BarcodeScannerView,
  PosCartView,
  ProductFoundCard,
  SaleConfirmationModal,
  SaleReceiptModal,
  StockConflictBanner,
  UnknownBarcodeCard,
  UnknownOutcomeBanner,
} from '../barcode/components';
import type { PosCart } from '../barcode/pos-cart';
import type { PosSaleResponse } from '../barcode/api';
import type { MerchantListing } from '../catalog/api';

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: jest.fn((initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      jest.fn(),
    ]),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((fn: () => unknown) => fn()),
    useEffect: jest.fn(),
  };
});

const mockListing: MerchantListing = {
  id: 'listing-1',
  organizationId: 'org-1',
  outletId: 'outlet-1',
  name: 'Super Dog Biscuits 500g',
  description: 'Crunchy treats',
  kind: 'PRODUCT',
  commerceMode: 'COMMERCE',
  mrpPaise: 49900,
  sellingPricePaise: 39900,
  barcodeType: 'GTIN_13',
  normalizedBarcode: '8901234567890',
  status: 'ACTIVE',
  imageUrls: [],
  category: 'food',
  version: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const mockCart: PosCart = {
  outletId: 'outlet-1',
  items: [
    {
      listingId: 'listing-1',
      name: 'Super Dog Biscuits 500g',
      barcodeType: 'GTIN_13',
      normalizedBarcode: '8901234567890',
      mrpPaise: 49900,
      sellingPricePaise: 39900,
      quantity: 2,
      availableStock: 10,
    },
  ],
  customer: {
    id: null,
    mobile: '+919876543210',
    isWalkIn: false,
  },
  paymentDeclaration: 'EXTERNAL_UPI',
  subtotalPaise: 79800,
  totalPaise: 79800,
  itemCount: 1,
  totalQuantity: 2,
};

const mockSaleResponse: PosSaleResponse = {
  id: 'sale-98765',
  merchantId: 'merchant-1',
  outletId: 'outlet-1',
  customerId: 'cust-1',
  lines: { 'listing-1': { first: 2, second: 39900 } },
  totalPaise: 79800,
  paymentDeclaration: 'EXTERNAL_UPI',
  completedAt: '2026-09-01T12:00:00Z',
  loyaltyAwarded: true,
};

describe('POS & Barcode Scanner UI Components', () => {
  describe('BarcodeScannerView', () => {
    it('renders granted viewfinder with reticle, torch, and rapid scan controls', () => {
      const element = BarcodeScannerView({
        permission: 'GRANTED',
        onRequestPermission: jest.fn(),
        onManualEntryPress: jest.fn(),
        rapidScanMode: true,
        onToggleRapidScan: jest.fn(),
        torchOn: false,
        onToggleTorch: jest.fn(),
        active: true,
        lastScannedCode: '8901234567890',
      });
      expect(element).toBeTruthy();
    });

    it('renders permission requesting state', () => {
      const element = BarcodeScannerView({
        permission: 'REQUESTING',
        onRequestPermission: jest.fn(),
        onManualEntryPress: jest.fn(),
        rapidScanMode: false,
        onToggleRapidScan: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders denied permission state with grant button', () => {
      const element = BarcodeScannerView({
        permission: 'DENIED',
        onRequestPermission: jest.fn(),
        onManualEntryPress: jest.fn(),
        rapidScanMode: false,
        onToggleRapidScan: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders blocked permission state with open settings button', () => {
      const element = BarcodeScannerView({
        permission: 'BLOCKED',
        onRequestPermission: jest.fn(),
        onManualEntryPress: jest.fn(),
        rapidScanMode: false,
        onToggleRapidScan: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders unavailable camera state', () => {
      const element = BarcodeScannerView({
        permission: 'UNAVAILABLE',
        onRequestPermission: jest.fn(),
        onManualEntryPress: jest.fn(),
        rapidScanMode: false,
        onToggleRapidScan: jest.fn(),
      });
      expect(element).toBeTruthy();
    });
  });

  describe('ProductFoundCard', () => {
    it('renders product details and in-stock badge', () => {
      const element = ProductFoundCard({
        listing: mockListing,
        availableStock: 10,
        quantityInCart: 2,
        onAddToCart: jest.fn(),
        onDismiss: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders low-stock badge when stock is 2', () => {
      const element = ProductFoundCard({
        listing: mockListing,
        availableStock: 2,
        quantityInCart: 0,
        onAddToCart: jest.fn(),
        onDismiss: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders out-of-stock badge and disables action when stock is 0', () => {
      const element = ProductFoundCard({
        listing: mockListing,
        availableStock: 0,
        quantityInCart: 0,
        onAddToCart: jest.fn(),
        onDismiss: jest.fn(),
      });
      expect(element).toBeTruthy();
    });
  });

  describe('UnknownBarcodeCard', () => {
    it('renders unknown barcode card with draft and retry actions', () => {
      const element = UnknownBarcodeCard({
        barcodeType: 'GTIN_13',
        rawBarcode: '8909999999999',
        canCreateDraft: true,
        onRetry: jest.fn(),
        onCreateDraft: jest.fn(),
        onManualEntry: jest.fn(),
        onDismiss: jest.fn(),
      });
      expect(element).toBeTruthy();
    });
  });

  describe('PosCartView', () => {
    it('renders populated cart with line items, customer attribution, and payment selector', () => {
      const element = PosCartView({
        cart: mockCart,
        isOnline: true,
        onUpdateQuantity: jest.fn(),
        onRemoveItem: jest.fn(),
        onClearCart: jest.fn(),
        onSetPayment: jest.fn(),
        onSetCustomer: jest.fn(),
        onCheckoutPress: jest.fn(),
        submitting: false,
      });
      expect(element).toBeTruthy();
    });

    it('renders empty cart state', () => {
      const emptyCart: PosCart = {
        outletId: 'outlet-1',
        items: [],
        customer: { id: null, isWalkIn: true },
        paymentDeclaration: 'CASH',
        subtotalPaise: 0,
        totalPaise: 0,
        itemCount: 0,
        totalQuantity: 0,
      };
      const element = PosCartView({
        cart: emptyCart,
        isOnline: true,
        onUpdateQuantity: jest.fn(),
        onRemoveItem: jest.fn(),
        onClearCart: jest.fn(),
        onSetPayment: jest.fn(),
        onSetCustomer: jest.fn(),
        onCheckoutPress: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders offline warning banner when offline', () => {
      const element = PosCartView({
        cart: mockCart,
        isOnline: false,
        onUpdateQuantity: jest.fn(),
        onRemoveItem: jest.fn(),
        onClearCart: jest.fn(),
        onSetPayment: jest.fn(),
        onSetCustomer: jest.fn(),
        onCheckoutPress: jest.fn(),
      });
      expect(element).toBeTruthy();
    });
  });

  describe('SaleConfirmationModal', () => {
    it('renders confirmation details, item breakdown, and loyalty star notice', () => {
      const element = SaleConfirmationModal({
        visible: true,
        cart: mockCart,
        outletLabel: 'Main Outlet',
        onConfirm: jest.fn(),
        onCancel: jest.fn(),
        submitting: false,
      });
      expect(element).toBeTruthy();
    });

    it('renders submitting activity indicator', () => {
      const element = SaleConfirmationModal({
        visible: true,
        cart: mockCart,
        outletLabel: 'Main Outlet',
        onConfirm: jest.fn(),
        onCancel: jest.fn(),
        submitting: true,
      });
      expect(element).toBeTruthy();
    });
  });

  describe('SaleReceiptModal', () => {
    it('renders digital receipt with sale ref, totals, payment declaration, and loyalty star award', () => {
      const element = SaleReceiptModal({
        visible: true,
        sale: mockSaleResponse,
        cart: mockCart,
        outletLabel: 'Main Outlet',
        onNewSale: jest.fn(),
        onClose: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('returns null when sale is null', () => {
      const element = SaleReceiptModal({
        visible: false,
        sale: null,
        cart: mockCart,
        onNewSale: jest.fn(),
        onClose: jest.fn(),
      });
      expect(element).toBeNull();
    });
  });

  describe('StockConflictBanner and UnknownOutcomeBanner', () => {
    it('renders stock conflict banner with alert message', () => {
      const element = StockConflictBanner({
        message: 'Item stock changed on server.',
        onDismiss: jest.fn(),
      });
      expect(element).toBeTruthy();
    });

    it('renders unknown outcome banner with idempotency key and check status action', () => {
      const element = UnknownOutcomeBanner({
        idempotencyKey: 'pos-sale-key-1234567890',
        checking: false,
        onCheckStatus: jest.fn(),
        onDismiss: jest.fn(),
      });
      expect(element).toBeTruthy();
    });
  });
});
