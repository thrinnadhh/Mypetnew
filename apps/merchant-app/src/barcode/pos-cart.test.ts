import {
  addItemToCart,
  clearCart,
  createEmptyCart,
  formatPaiseToRupees,
  hasStockConflict,
  isItemLowStock,
  isItemOutOfStock,
  removeItemFromCart,
  setCartCustomer,
  setCartPaymentDeclaration,
  updateItemQuantity,
  validateCartForCheckout,
  type PosCart,
  type PosCartItem,
} from './pos-cart';

describe('POS Cart Domain Logic', () => {
  const OUTLET_A = '11111111-1111-1111-1111-111111111111';

  const ITEM_1: Omit<PosCartItem, 'quantity'> = {
    listingId: 'item-1',
    name: 'Premium Dog Food 3kg',
    barcodeType: 'GTIN_13',
    normalizedBarcode: '8901234567890',
    mrpPaise: 120000,
    sellingPricePaise: 99900,
    availableStock: 15,
  };

  const ITEM_2: Omit<PosCartItem, 'quantity'> = {
    listingId: 'item-2',
    name: 'Cat Chews 100g',
    barcodeType: 'GTIN_8',
    normalizedBarcode: '01234565',
    mrpPaise: 35000,
    sellingPricePaise: 29900,
    availableStock: 2,
  };

  it('creates an empty cart with default walk-in customer and cash payment', () => {
    const cart = createEmptyCart(OUTLET_A);
    expect(cart.outletId).toBe(OUTLET_A);
    expect(cart.items).toHaveLength(0);
    expect(cart.customer.isWalkIn).toBe(true);
    expect(cart.paymentDeclaration).toBe('CASH');
    expect(cart.totalPaise).toBe(0);
    expect(cart.totalQuantity).toBe(0);
  });

  it('adds items and calculates item count, total quantity, and grand total', () => {
    let cart = createEmptyCart(OUTLET_A);
    cart = addItemToCart(cart, ITEM_1, 2);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
    expect(cart.totalQuantity).toBe(2);
    expect(cart.totalPaise).toBe(199800);

    // Add another item
    cart = addItemToCart(cart, ITEM_2, 1);
    expect(cart.items).toHaveLength(2);
    expect(cart.itemCount).toBe(2);
    expect(cart.totalQuantity).toBe(3);
    expect(cart.totalPaise).toBe(199800 + 29900);

    // Add existing item again -> increments quantity
    cart = addItemToCart(cart, ITEM_1, 1);
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0].quantity).toBe(3);
    expect(cart.totalQuantity).toBe(4);
  });

  it('updates item quantities and removes items when quantity reaches 0', () => {
    let cart = createEmptyCart(OUTLET_A);
    cart = addItemToCart(cart, ITEM_1, 2);
    cart = addItemToCart(cart, ITEM_2, 1);

    cart = updateItemQuantity(cart, ITEM_1.listingId, 5);
    expect(cart.items.find((i) => i.listingId === ITEM_1.listingId)?.quantity).toBe(5);

    // Update to 0 -> removes item
    cart = updateItemQuantity(cart, ITEM_2.listingId, 0);
    expect(cart.items.find((i) => i.listingId === ITEM_2.listingId)).toBeUndefined();
    expect(cart.items).toHaveLength(1);
  });

  it('removes item directly and clears cart', () => {
    let cart = createEmptyCart(OUTLET_A);
    cart = addItemToCart(cart, ITEM_1, 2);
    cart = addItemToCart(cart, ITEM_2, 1);

    cart = removeItemFromCart(cart, ITEM_1.listingId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].listingId).toBe(ITEM_2.listingId);

    cart = clearCart(OUTLET_A);
    expect(cart.items).toHaveLength(0);
    expect(cart.totalPaise).toBe(0);
  });

  it('updates customer and payment declaration', () => {
    let cart = createEmptyCart(OUTLET_A);
    cart = setCartCustomer(cart, {
      id: null,
      mobile: '+919876543210',
      isWalkIn: false,
    });
    expect(cart.customer.mobile).toBe('+919876543210');
    expect(cart.customer.isWalkIn).toBe(false);

    cart = setCartPaymentDeclaration(cart, 'EXTERNAL_UPI');
    expect(cart.paymentDeclaration).toBe('EXTERNAL_UPI');
  });

  it('detects low stock and out-of-stock items', () => {
    expect(isItemLowStock({ ...ITEM_2, quantity: 1 })).toBe(true); // availableStock = 2
    expect(isItemLowStock({ ...ITEM_1, quantity: 1 })).toBe(false); // availableStock = 15
    expect(isItemOutOfStock({ ...ITEM_1, availableStock: 0, quantity: 1 })).toBe(true);
  });

  it('validates checkout safety boundaries', () => {
    let cart = createEmptyCart(OUTLET_A);

    // Empty cart rejected
    expect(validateCartForCheckout(cart, true)).toContain('empty');

    cart = addItemToCart(cart, ITEM_1, 1);

    // Offline checkout strictly rejected
    expect(validateCartForCheckout(cart, false)).toContain('Offline sale completion is disabled');

    // Cart with offline draft rejected
    const draftCart: PosCart = {
      ...cart,
      items: [{ ...ITEM_1, quantity: 1, isOfflineDraft: true }],
    };
    expect(validateCartForCheckout(draftCart, true)).toContain('local offline drafts');

    // Stock conflict rejected
    const stockExceededCart: PosCart = {
      ...cart,
      items: [{ ...ITEM_2, quantity: 5, availableStock: 2 }],
    };
    expect(hasStockConflict(stockExceededCart)).toBe(true);
    expect(validateCartForCheckout(stockExceededCart, true)).toContain('Insufficient stock');

    // Valid online cart passes
    expect(validateCartForCheckout(cart, true)).toBeNull();
  });

  it('formats paise to INR currency strings', () => {
    expect(formatPaiseToRupees(99900)).toBe('₹999.00');
    expect(formatPaiseToRupees(0)).toBe('₹0.00');
    expect(formatPaiseToRupees(125050)).toBe('₹1,250.50');
  });
});
