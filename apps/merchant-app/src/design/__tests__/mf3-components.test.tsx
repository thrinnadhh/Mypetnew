import React from 'react';
import {
  CatalogProductCard,
  ConfirmationModal,
  FilterBar,
  InventoryCard,
  MovementLedgerModal,
  OrderCard,
  OrderDetailModal,
  ProductEditorModal,
  SearchInput,
  StockAdjustmentModal,
  formatPaise,
  getStockStatus,
  orderStatusLabel,
  orderStatusVariant,
} from '../components';

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

describe('MF3 Operational Design Components', () => {
  describe('FilterBar', () => {
    it('renders accessible horizontal filter chips with badges and selection states', () => {
      const onSelect = jest.fn();
      const options = [
        { id: 'ALL', label: 'All Orders', badge: 12 },
        { id: 'NEW', label: 'New', badge: 3 },
        { id: 'ACCEPTED', label: 'Accepted' },
      ];
      const bar = FilterBar({
        options,
        selectedId: 'NEW',
        onSelect,
        testID: 'order-filter',
      });
      expect(bar).toBeTruthy();
      expect(bar.props.accessibilityRole).toBe('tablist');
    });
  });

  describe('SearchInput', () => {
    it('renders search input with clear button and barcode action', () => {
      const onChange = jest.fn();
      const onClear = jest.fn();
      const onScan = jest.fn();
      const search = SearchInput({
        value: 'Salmon',
        onChangeText: onChange,
        onClear,
        onBarcodeScan: onScan,
        placeholder: 'Search products…',
        testID: 'search-input',
      });
      expect(search).toBeTruthy();
    });
  });

  describe('ConfirmationModal', () => {
    it('renders accessible confirmation dialog with optional reason input and validation', () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      const modal = ConfirmationModal({
        visible: true,
        title: 'Reject Order',
        message: 'Are you sure you want to reject order #4922?',
        confirmLabel: 'Reject Order',
        variant: 'destructive',
        requireReason: true,
        onConfirm,
        onCancel,
        testID: 'confirm-modal',
      });
      expect(modal).toBeTruthy();
    });
  });

  describe('OrderCard & Order Helpers', () => {
    const mockOrder = {
      orderId: 'ord-123',
      orderNumber: 'MP-ORD4922',
      outletId: 'outlet-1',
      status: 'PLACED' as const,
      fulfilmentMode: 'STORE_PICKUP',
      grandTotalPaise: 450000,
      paymentStatus: 'PAID',
      createdAt: '2026-09-01T12:00:00Z',
    };

    it('formats paise correctly into INR currency strings', () => {
      expect(formatPaise(450000)).toBe('₹4500.00');
      expect(formatPaise(9900)).toBe('₹99.00');
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('maps order statuses to appropriate badge labels and variants', () => {
      expect(orderStatusLabel('PLACED')).toBe('New Order');
      expect(orderStatusLabel('READY_FOR_PICKUP')).toBe('Ready for Pickup');
      expect(orderStatusVariant('PLACED')).toBe('warning');
      expect(orderStatusVariant('DELIVERED')).toBe('success');
      expect(orderStatusVariant('REJECTED')).toBe('error');
    });

    it('renders OrderCard with order metadata and action buttons', () => {
      const onTransition = jest.fn();
      const onViewDetails = jest.fn();
      const card = OrderCard({
        order: mockOrder,
        availableTargets: ['ACCEPTED', 'REJECTED'],
        onTransition,
        onViewDetails,
        testID: 'order-card',
      });
      expect(card).toBeTruthy();
      expect(card.props.accessibilityLabel).toContain('Order MP-ORD4922');
      expect(card.props.accessibilityLabel).toContain('₹4500.00');
    });

    it('renders OrderDetailModal with breakdown and identifiers', () => {
      const modal = OrderDetailModal({
        visible: true,
        order: mockOrder,
        availableTargets: ['ACCEPTED', 'REJECTED'],
        onClose: jest.fn(),
        onTransition: jest.fn(),
        testID: 'order-detail-modal',
      });
      expect(modal).toBeTruthy();
    });
  });

  describe('InventoryCard & Stock Helpers', () => {
    it('calculates stock status correctly for in stock, low stock, and out of stock', () => {
      expect(getStockStatus(15, 5)).toEqual({ label: 'In Stock', variant: 'success' });
      expect(getStockStatus(4, 5)).toEqual({ label: 'Low Stock', variant: 'warning' });
      expect(getStockStatus(0, 5)).toEqual({ label: 'Out of Stock', variant: 'error' });
      expect(getStockStatus(-2, 5)).toEqual({ label: 'Out of Stock', variant: 'error' });
    });

    it('renders InventoryCard with 3-col stock metrics and sync state', () => {
      const card = InventoryCard({
        balance: {
          organizationId: 'org-1',
          outletId: 'outlet-1',
          listingId: 'list-1',
          onHand: 24,
          reserved: 4,
          available: 20,
          version: 1,
          updatedAt: '2026-09-01T12:00:00Z',
        },
        listingName: 'Royal Canin Maxi Adult Dog Food',
        sku: 'RC-MAXI-15',
        barcode: '8901234567890',
        category: 'dog-food',
        syncStatus: 'Canonical',
        onAdjust: jest.fn(),
        onReceive: jest.fn(),
        onMoreOps: jest.fn(),
        onViewLedger: jest.fn(),
        testID: 'inv-card',
      });
      expect(card).toBeTruthy();
      expect(card.props.accessibilityLabel).toContain('Royal Canin Maxi Adult Dog Food');
      expect(card.props.accessibilityLabel).toContain('available 20');
    });

    it('renders StockAdjustmentModal for multi-mode inventory operations', () => {
      const modal = StockAdjustmentModal({
        visible: true,
        listingId: 'list-1',
        listingName: 'Royal Canin Maxi Adult',
        currentBalance: {
          organizationId: 'org-1',
          outletId: 'outlet-1',
          listingId: 'list-1',
          onHand: 10,
          reserved: 0,
          available: 10,
          version: 1,
          updatedAt: '2026-09-01T12:00:00Z',
        },
        initialMode: 'ADJUSTMENT',
        onClose: jest.fn(),
        onManualAdjustment: jest.fn().mockResolvedValue(undefined),
        onReceiving: jest.fn().mockResolvedValue(undefined),
        onDamage: jest.fn().mockResolvedValue(undefined),
        onExpiry: jest.fn().mockResolvedValue(undefined),
        onShrinkage: jest.fn().mockResolvedValue(undefined),
        onReturn: jest.fn().mockResolvedValue(undefined),
        onTransfer: jest.fn().mockResolvedValue(undefined),
        testID: 'stock-adjust-modal',
      });
      expect(modal).toBeTruthy();
    });

    it('renders MovementLedgerModal with movement trail', () => {
      const modal = MovementLedgerModal({
        visible: true,
        listingName: 'Royal Canin Maxi Adult',
        movements: [
          {
            id: 'mov-1',
            listingId: 'list-1',
            reason: 'RECEIVING',
            quantityDelta: 24,
            resultingOnHand: 24,
            resultingReserved: 0,
            sourceReference: 'PO-8821',
            occurredAt: '2026-09-01T10:00:00Z',
          },
          {
            id: 'mov-2',
            listingId: 'list-1',
            reason: 'MANUAL_DECREASE',
            quantityDelta: -2,
            resultingOnHand: 22,
            resultingReserved: 0,
            sourceReference: 'manual-audit',
            occurredAt: '2026-09-01T11:00:00Z',
          },
        ],
        onClose: jest.fn(),
        testID: 'ledger-modal',
      });
      expect(modal).toBeTruthy();
    });
  });

  describe('CatalogProductCard & ProductEditorModal', () => {
    const mockListing = {
      id: 'list-1',
      organizationId: 'org-1',
      outletId: 'outlet-1',
      barcodeType: 'GTIN_13' as const,
      normalizedBarcode: '8901234567890',
      name: 'Grain-Free Salmon Dog Food',
      kind: 'PRODUCT' as const,
      commerceMode: 'COMMERCE' as const,
      mrpPaise: 450000,
      sellingPricePaise: 420000,
      category: 'dog-food',
      brand: 'PetPurity',
      sku: 'DG-SLM-15',
      imageUrls: ['https://example.com/salmon.jpg'],
      status: 'ACTIVE' as const,
      version: 2,
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-22T00:00:00Z',
    };

    it('renders CatalogProductCard with price comparison, discount, image quota, and status toggle', () => {
      const card = CatalogProductCard({
        listing: mockListing,
        onEdit: jest.fn(),
        onToggleStatus: jest.fn(),
        onAddImage: jest.fn(),
        testID: 'catalog-card',
      });
      expect(card).toBeTruthy();
      expect(card.props.accessibilityLabel).toContain('Grain-Free Salmon Dog Food');
      expect(card.props.accessibilityLabel).toContain('₹4200.00');
    });

    it('renders ProductEditorModal in create and edit modes', () => {
      const modalCreate = ProductEditorModal({
        visible: true,
        onClose: jest.fn(),
        onSaveCreate: jest.fn().mockResolvedValue(undefined),
        onSaveUpdate: jest.fn().mockResolvedValue(undefined),
        testID: 'editor-modal-create',
      });
      expect(modalCreate).toBeTruthy();

      const modalEdit = ProductEditorModal({
        visible: true,
        editingListing: mockListing,
        onClose: jest.fn(),
        onSaveCreate: jest.fn().mockResolvedValue(undefined),
        onSaveUpdate: jest.fn().mockResolvedValue(undefined),
        testID: 'editor-modal-edit',
      });
      expect(modalEdit).toBeTruthy();
    });
  });
});
