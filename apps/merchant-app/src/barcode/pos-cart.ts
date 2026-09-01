import type { BarcodeType } from '../catalog/api';

export type PaymentDeclaration = 'CASH' | 'EXTERNAL_UPI' | 'CARD_TERMINAL';

export type PosCartItem = {
  listingId: string;
  name: string;
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  mrpPaise: number;
  sellingPricePaise: number;
  quantity: number;
  availableStock: number;
  isOfflineDraft?: boolean;
};

export type CustomerSummary = {
  id: string | null;
  mobile?: string;
  name?: string;
  associationChallengeId?: string | null;
  isWalkIn: boolean;
};

export type PosCart = {
  outletId: string;
  items: PosCartItem[];
  customer: CustomerSummary;
  paymentDeclaration: PaymentDeclaration;
  subtotalPaise: number;
  totalPaise: number;
  itemCount: number;
  totalQuantity: number;
};

export const DEFAULT_WALK_IN_CUSTOMER: CustomerSummary = {
  id: null,
  isWalkIn: true,
};

function recalculateCartTotals(outletId: string, items: PosCartItem[], customer: CustomerSummary, paymentDeclaration: PaymentDeclaration): PosCart {
  const itemCount = items.length;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPaise = items.reduce((sum, item) => sum + item.sellingPricePaise * item.quantity, 0);
  return {
    outletId,
    items,
    customer,
    paymentDeclaration,
    subtotalPaise: totalPaise,
    totalPaise,
    itemCount,
    totalQuantity,
  };
}

export function createEmptyCart(outletId: string): PosCart {
  return {
    outletId,
    items: [],
    customer: DEFAULT_WALK_IN_CUSTOMER,
    paymentDeclaration: 'CASH',
    subtotalPaise: 0,
    totalPaise: 0,
    itemCount: 0,
    totalQuantity: 0,
  };
}

export function addItemToCart(
  cart: PosCart,
  item: Omit<PosCartItem, 'quantity'>,
  quantityToAdd = 1,
): PosCart {
  if (quantityToAdd <= 0) return cart;
  const existingIndex = cart.items.findIndex((i) => i.listingId === item.listingId);
  let updatedItems: PosCartItem[];
  if (existingIndex >= 0) {
    const existing = cart.items[existingIndex];
    const newQuantity = existing.quantity + quantityToAdd;
    const updated = { ...existing, quantity: newQuantity, availableStock: item.availableStock, sellingPricePaise: item.sellingPricePaise };
    updatedItems = [...cart.items];
    updatedItems[existingIndex] = updated;
  } else {
    updatedItems = [...cart.items, { ...item, quantity: quantityToAdd }];
  }
  return recalculateCartTotals(cart.outletId, updatedItems, cart.customer, cart.paymentDeclaration);
}

export function updateItemQuantity(
  cart: PosCart,
  listingId: string,
  quantity: number,
): PosCart {
  if (quantity <= 0) {
    return removeItemFromCart(cart, listingId);
  }
  const updatedItems = cart.items.map((item) =>
    item.listingId === listingId ? { ...item, quantity } : item,
  );
  return recalculateCartTotals(cart.outletId, updatedItems, cart.customer, cart.paymentDeclaration);
}

export function removeItemFromCart(cart: PosCart, listingId: string): PosCart {
  const updatedItems = cart.items.filter((item) => item.listingId !== listingId);
  return recalculateCartTotals(cart.outletId, updatedItems, cart.customer, cart.paymentDeclaration);
}

export function clearCart(outletId: string): PosCart {
  return createEmptyCart(outletId);
}

export function setCartCustomer(cart: PosCart, customer: CustomerSummary): PosCart {
  return {
    ...cart,
    customer,
  };
}

export function setCartPaymentDeclaration(
  cart: PosCart,
  paymentDeclaration: PaymentDeclaration,
): PosCart {
  return {
    ...cart,
    paymentDeclaration,
  };
}

export function isItemLowStock(item: PosCartItem): boolean {
  return item.availableStock > 0 && item.availableStock <= 3;
}

export function isItemOutOfStock(item: PosCartItem): boolean {
  return item.availableStock <= 0;
}

export function hasStockConflict(cart: PosCart): boolean {
  return cart.items.some((item) => item.quantity > item.availableStock);
}

export function validateCartForCheckout(cart: PosCart, isOnline: boolean): string | null {
  if (cart.items.length === 0) {
    return 'Cart is empty. Scan products before checkout.';
  }
  if (!isOnline) {
    return 'Offline sale completion is disabled. Reconnect to complete POS transactions.';
  }
  if (cart.items.some((item) => item.isOfflineDraft)) {
    return 'Cart contains local offline drafts without canonical server identity. Sync drafts first.';
  }
  const stockExceededItem = cart.items.find((item) => item.quantity > item.availableStock);
  if (stockExceededItem) {
    return `Insufficient stock for "${stockExceededItem.name}". Requested: ${stockExceededItem.quantity}, Available: ${stockExceededItem.availableStock}.`;
  }
  return null;
}

export function formatPaiseToRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
