import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import type { CommerceProduct, ProductVariant } from '@/services/catalog-data';
import { isCommerceEligible } from '@/services/commerce-eligibility';

export interface CartItem {
  product: CommerceProduct;
  selectedVariant?: ProductVariant;
  quantity: number;
  unitPrice: number;
}

interface CartContextType {
  items: CartItem[];
  providerId: string | null;
  providerName: string | null;
  totalItemsCount: number;
  subtotalAmount: number;
  loading: boolean;
  addToCart: (product: CommerceProduct, variant?: ProductVariant, qty?: number) => boolean;
  removeFromCart: (productId: string, variantId?: string) => void;
  updateQuantity: (productId: string, variantId: string | undefined, qty: number) => void;
  clearCart: () => Promise<void>;
  replaceCart: (nextItems: CartItem[]) => Promise<void>;
  revalidateCart: () => boolean;
}

interface StoredCart {
  items: CartItem[];
  providerId: string | null;
  providerName: string | null;
}

interface SanitizedStoredCart {
  items: CartItem[];
  changed: boolean;
}

const CartContext = createContext<CartContextType | null>(null);
const LEGACY_STORAGE_KEY = 'mypet_cart_v1';
const STORAGE_PREFIX = 'mypet_cart_v2';

export function clampCartQuantity(value: number, maxStock: number): number {
  const normalizedMax = Math.max(0, Math.floor(maxStock));
  if (normalizedMax === 0 || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(1, Math.floor(value)), normalizedMax);
}

export function stockForCartLine(product: CommerceProduct, variant?: ProductVariant): number {
  const productStock = product.availableQuantity ?? product.stockCount;
  const variantStock = variant?.stockCount ?? productStock;
  if (!Number.isFinite(productStock) || !Number.isFinite(variantStock)) return 0;
  return Math.max(0, Math.min(Math.floor(productStock), Math.floor(variantStock)));
}

function storageIdentity(userId?: string | null): string {
  return userId ? `customer_${userId}` : 'guest';
}

function storageKeyFor(userId?: string | null): string {
  return `${STORAGE_PREFIX}_${storageIdentity(userId)}`;
}

function matchesCartLine(item: CartItem, productId: string, variantId?: string): boolean {
  return item.product.id === productId &&
    (variantId === undefined || item.selectedVariant?.id === variantId);
}

function cartLineKey(item: CartItem): string {
  return `${item.product.id}:${item.selectedVariant?.id ?? 'default'}`;
}

function canonicalVariant(product: CommerceProduct, requested?: ProductVariant): ProductVariant | undefined {
  if (!Array.isArray(product.variants) || product.variants.length === 0) return undefined;
  if (!requested?.id) return product.variants[0];
  return product.variants.find((variant) => variant.id === requested.id);
}

function normalizeCartLine(item: CartItem): CartItem | null {
  const product = item?.product;
  if (
    !product ||
    typeof product.id !== 'string' || !product.id ||
    typeof product.providerId !== 'string' || !product.providerId ||
    typeof product.providerName !== 'string' || !product.providerName ||
    typeof product.name !== 'string' || !product.name ||
    !Number.isFinite(product.price) ||
    !Array.isArray(product.variants) ||
    !Array.isArray(product.galleryImages) ||
    !Array.isArray(product.suitability) ||
    !product.specifications || typeof product.specifications !== 'object' ||
    !isCommerceEligible(product)
  ) {
    return null;
  }

  const variant = canonicalVariant(product, item.selectedVariant);
  if (!variant || !variant.inStock || !Number.isFinite(variant.price) || !Number.isFinite(variant.stockCount)) {
    return null;
  }

  const maxStock = stockForCartLine(product, variant);
  const quantity = clampCartQuantity(item.quantity, maxStock);
  if (quantity <= 0) return null;

  return {
    product,
    selectedVariant: variant,
    quantity,
    unitPrice: variant.price,
  };
}

export function sanitizeStoredCartItems(value: unknown): SanitizedStoredCart {
  if (!Array.isArray(value)) return { items: [], changed: value !== undefined && value !== null };

  const byLine = new Map<string, CartItem>();
  let providerId: string | null = null;
  let changed = false;

  for (const rawItem of value) {
    const item = normalizeCartLine(rawItem as CartItem);
    if (!item) {
      changed = true;
      continue;
    }

    if (providerId === null) providerId = item.product.providerId;
    if (providerId !== item.product.providerId) {
      changed = true;
      continue;
    }

    const key = cartLineKey(item);
    const existing = byLine.get(key);
    if (!existing) {
      byLine.set(key, item);
      if (
        item.quantity !== (rawItem as CartItem).quantity ||
        item.unitPrice !== (rawItem as CartItem).unitPrice ||
        item.selectedVariant?.id !== (rawItem as CartItem).selectedVariant?.id
      ) {
        changed = true;
      }
      continue;
    }

    changed = true;
    const maxStock = stockForCartLine(existing.product, existing.selectedVariant);
    byLine.set(key, {
      ...existing,
      quantity: clampCartQuantity(existing.quantity + item.quantity, maxStock),
    });
  }

  return { items: [...byLine.values()], changed };
}

function parseStoredCart(raw: string | null): SanitizedStoredCart {
  if (!raw) return { items: [], changed: false };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    const sanitized = sanitizeStoredCartItems(parsed.items);
    return {
      items: sanitized.items,
      changed: sanitized.changed || !Array.isArray(parsed.items),
    };
  } catch {
    return { items: [], changed: true };
  }
}

export function mergeSameProviderCartItems(
  preferredItems: readonly CartItem[],
  incomingItems: readonly CartItem[],
): CartItem[] {
  const sanitized = sanitizeStoredCartItems([...preferredItems, ...incomingItems]);
  return sanitized.items;
}

export function sanitizeCartItemsForRevalidation(currentItems: CartItem[]): { items: CartItem[]; valid: boolean } {
  let valid = true;
  const items = currentItems.flatMap((item) => {
    if (!isCommerceEligible(item.product)) {
      valid = false;
      return [];
    }

    const maxStock = stockForCartLine(item.product, item.selectedVariant);
    if (
      !item.product.inStock ||
      (item.selectedVariant && !item.selectedVariant.inStock) ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      maxStock <= 0
    ) {
      valid = false;
      return [];
    }

    const canonicalUnitPrice = item.selectedVariant?.price ?? item.product.price;
    if (item.quantity > maxStock) {
      valid = false;
      return [{ ...item, quantity: maxStock, unitPrice: canonicalUnitPrice }];
    }

    return [{ ...item, unitPrice: canonicalUnitPrice }];
  });

  return { items, valid };
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const storageKey = useMemo(() => storageKeyFor(user?.id), [user?.id]);
  const [items, setItems] = useState<CartItem[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const itemsRef = useRef<CartItem[]>([]);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const previousIdentityRef = useRef(storageIdentity(user?.id));

  const applyCart = useCallback((cartItems: CartItem[]) => {
    itemsRef.current = cartItems;
    const first = cartItems[0];
    setItems(cartItems);
    setProviderId(first?.product.providerId ?? null);
    setProviderName(first?.product.providerName ?? null);
  }, []);

  const persistCart = useCallback((newItems: CartItem[], key = storageKey): Promise<void> => {
    const snapshot = newItems.map((item) => ({ ...item }));
    const first = snapshot[0];
    const payload: StoredCart = {
      items: snapshot,
      providerId: first?.product.providerId ?? null,
      providerName: first?.product.providerName ?? null,
    };
    const write = async () => {
      if (snapshot.length === 0) {
        await AsyncStorage.removeItem(key);
      } else {
        await AsyncStorage.setItem(key, JSON.stringify(payload));
      }
    };
    const queued = writeQueueRef.current.then(write, write);
    writeQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    const currentIdentity = storageIdentity(user?.id);
    const previousIdentity = previousIdentityRef.current;
    previousIdentityRef.current = currentIdentity;

    const loadStoredCart = async () => {
      setLoading(true);
      applyCart([]);
      try {
        let stored = await AsyncStorage.getItem(storageKey);
        if (!stored && !user?.id) {
          stored = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (stored) {
            await AsyncStorage.setItem(storageKey, stored);
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }

        let normalized = parseStoredCart(stored);
        if (!active) return;

        if (normalized.changed) {
          await persistCart(normalized.items, storageKey);
        }

        const shouldMergeGuest = Boolean(user?.id) && previousIdentity === 'guest';
        if (shouldMergeGuest) {
          const guestKey = storageKeyFor(null);
          const guest = parseStoredCart(await AsyncStorage.getItem(guestKey));
          if (!active) return;

          if (guest.items.length > 0 && normalized.items.length === 0) {
            normalized = { items: guest.items, changed: true };
            await persistCart(guest.items, storageKey);
            await AsyncStorage.removeItem(guestKey);
          } else if (guest.items.length > 0 && normalized.items.length > 0) {
            const guestProvider = guest.items[0].product.providerId;
            const savedProvider = normalized.items[0].product.providerId;
            if (guestProvider === savedProvider) {
              const merged = mergeSameProviderCartItems(normalized.items, guest.items);
              normalized = { items: merged, changed: true };
              await persistCart(merged, storageKey);
              await AsyncStorage.removeItem(guestKey);
            } else {
              const savedItems = normalized.items;
              Alert.alert(
                'Choose your cart',
                `Your guest cart is from "${guest.items[0].product.providerName}" while your saved cart is from "${savedItems[0].product.providerName}". MyPet cannot combine stores.`,
                [
                  {
                    text: 'Keep Saved Cart',
                    onPress: () => { void AsyncStorage.removeItem(guestKey); },
                  },
                  {
                    text: 'Use Guest Cart',
                    onPress: () => {
                      if (!active) return;
                      applyCart(guest.items);
                      void persistCart(guest.items, storageKey)
                        .then(() => AsyncStorage.removeItem(guestKey))
                        .catch((error) => console.warn('Failed to replace saved cart with guest cart', error));
                    },
                  },
                ],
              );
            }
          }
        }

        if (active) applyCart(normalized.items);
      } catch (error) {
        console.warn('Failed to load stored cart', error);
        if (active) applyCart([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadStoredCart();
    return () => {
      active = false;
    };
  }, [applyCart, persistCart, storageKey, user?.id]);

  const clearCart = useCallback(async () => {
    applyCart([]);
    await persistCart([]);
  }, [applyCart, persistCart]);

  const replaceCart = useCallback(async (nextItems: CartItem[]) => {
    const providerIds = new Set(nextItems.map((item) => item.product.providerId));
    if (providerIds.size > 1) {
      throw new Error('A cart can contain items from only one provider.');
    }

    const normalized = sanitizeStoredCartItems(nextItems).items;
    applyCart(normalized);
    await persistCart(normalized);
  }, [applyCart, persistCart]);

  const addToCart = useCallback(
    (product: CommerceProduct, variant?: ProductVariant, qty = 1): boolean => {
      const selectedVariant = canonicalVariant(product, variant);
      if (!isCommerceEligible(product)) {
        Alert.alert(
          'Item Unavailable',
          `${product.name} cannot be added to cart (view only, zero stock, or pickup unavailable).`,
        );
        return false;
      }
      if (!selectedVariant) {
        Alert.alert('Item Unavailable', `${product.name} does not have a purchasable variant.`);
        return false;
      }

      const maxStock = stockForCartLine(product, selectedVariant);
      if (!product.inStock || !selectedVariant.inStock || maxStock <= 0) {
        Alert.alert('Out of stock', `${product.name} is currently unavailable.`);
        return false;
      }

      const current = itemsRef.current;
      const currentProviderId = current[0]?.product.providerId ?? null;
      const currentProviderName = current[0]?.product.providerName ?? null;
      if (currentProviderId && currentProviderId !== product.providerId) {
        Alert.alert(
          'Replace Cart Items?',
          `Your cart contains items from "${currentProviderName ?? 'another shop'}". Clear it and start a new order from "${product.providerName}"?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear & Continue',
              style: 'destructive',
              onPress: () => {
                const quantity = clampCartQuantity(qty, maxStock);
                const newItems: CartItem[] = [{
                  product,
                  selectedVariant,
                  quantity,
                  unitPrice: selectedVariant.price,
                }];
                applyCart(newItems);
                void persistCart(newItems).catch((error) =>
                  console.warn('Failed to replace stored cart', error),
                );
              },
            },
          ],
        );
        return false;
      }

      const existingIndex = current.findIndex(
        (item) => item.product.id === product.id && item.selectedVariant?.id === selectedVariant.id,
      );
      let next: CartItem[];
      if (existingIndex >= 0) {
        next = [...current];
        const existing = next[existingIndex];
        next[existingIndex] = {
          ...existing,
          product,
          selectedVariant,
          unitPrice: selectedVariant.price,
          quantity: clampCartQuantity(existing.quantity + Math.max(1, Math.floor(qty)), maxStock),
        };
      } else {
        next = [
          ...current,
          {
            product,
            selectedVariant,
            quantity: clampCartQuantity(qty, maxStock),
            unitPrice: selectedVariant.price,
          },
        ];
      }

      applyCart(next);
      void persistCart(next).catch((error) => console.warn('Failed to save cart', error));
      return true;
    },
    [applyCart, persistCart],
  );

  const removeFromCart = useCallback((productId: string, variantId?: string) => {
    const next = itemsRef.current.filter((item) => !matchesCartLine(item, productId, variantId));
    applyCart(next);
    void persistCart(next).catch((error) => console.warn('Failed to update stored cart', error));
  }, [applyCart, persistCart]);

  const updateQuantity = useCallback((productId: string, variantId: string | undefined, qty: number) => {
    if (qty <= 0) {
      removeFromCart(productId, variantId);
      return;
    }

    let updated = false;
    const next = itemsRef.current.map((item) => {
      if (updated || !matchesCartLine(item, productId, variantId)) return item;
      updated = true;
      const maxStock = stockForCartLine(item.product, item.selectedVariant);
      const quantity = clampCartQuantity(qty, maxStock);
      return quantity > 0 ? { ...item, quantity } : item;
    });
    if (!updated) return;
    applyCart(next);
    void persistCart(next).catch((error) => console.warn('Failed to save quantity', error));
  }, [applyCart, persistCart, removeFromCart]);

  const revalidateCart = useCallback((): boolean => {
    const current = itemsRef.current;
    const { items: next, valid } = sanitizeCartItemsForRevalidation(current);
    applyCart(next);
    void persistCart(next).catch((error) => console.warn('Failed to persist cart revalidation', error));
    return valid;
  }, [applyCart, persistCart]);

  const totalItemsCount = items.reduce((total, item) => total + item.quantity, 0);
  const subtotalAmount = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        providerId,
        providerName,
        totalItemsCount,
        subtotalAmount,
        loading,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        replaceCart,
        revalidateCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
