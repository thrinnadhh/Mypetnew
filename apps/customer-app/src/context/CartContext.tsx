import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import type { CommerceProduct, ProductVariant } from '@/services/catalog-data';

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

const CartContext = createContext<CartContextType | null>(null);
const LEGACY_STORAGE_KEY = 'mypet_cart_v1';
const STORAGE_PREFIX = 'mypet_cart_v2';

function clampQuantity(value: number, maxStock: number): number {
  const normalizedMax = Math.max(0, maxStock);
  return Math.min(Math.max(1, Math.floor(value)), normalizedMax);
}

function stockFor(product: CommerceProduct, variant?: ProductVariant): number {
  return Math.max(0, variant?.stockCount ?? product.stockCount);
}

function storageIdentity(userId?: string | null): string {
  return userId ? `customer_${userId}` : 'guest';
}

function matchesCartLine(item: CartItem, productId: string, variantId?: string): boolean {
  return item.product.id === productId &&
    (variantId === undefined || item.selectedVariant?.id === variantId);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}_${storageIdentity(user?.id)}`,
    [user?.id],
  );
  const [items, setItems] = useState<CartItem[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyCart = useCallback((cartItems: CartItem[]) => {
    const first = cartItems[0];
    setItems(cartItems);
    setProviderId(first?.product.providerId ?? null);
    setProviderName(first?.product.providerName ?? null);
  }, []);

  const saveCartToStorage = useCallback(async (newItems: CartItem[]) => {
    const first = newItems[0];
    const payload: StoredCart = {
      items: newItems,
      providerId: first?.product.providerId ?? null,
      providerName: first?.product.providerName ?? null,
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
  }, [storageKey]);

  useEffect(() => {
    let active = true;

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

        if (!active || !stored) return;
        const parsed = JSON.parse(stored) as Partial<StoredCart>;
        if (!Array.isArray(parsed.items)) return;

        const validItems = parsed.items.filter((item): item is CartItem =>
          Boolean(
            item?.product?.id &&
              item.product.providerId &&
              Number.isFinite(item.quantity) &&
              item.quantity > 0 &&
              Number.isFinite(item.unitPrice),
          ),
        );
        applyCart(validItems);
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
  }, [applyCart, storageKey, user?.id]);

  const clearCart = useCallback(async () => {
    applyCart([]);
    await AsyncStorage.removeItem(storageKey);
  }, [applyCart, storageKey]);

  const replaceCart = useCallback(async (nextItems: CartItem[]) => {
    const providerIds = new Set(nextItems.map((item) => item.product.providerId));
    if (providerIds.size > 1) {
      throw new Error('A cart can contain items from only one provider.');
    }

    const normalized = nextItems
      .map((item) => {
        const maxStock = stockFor(item.product, item.selectedVariant);
        if (!item.product.inStock || maxStock <= 0) return null;
        const quantity = clampQuantity(item.quantity, maxStock);
        return {
          ...item,
          quantity,
          unitPrice: item.selectedVariant?.price ?? item.product.price,
        };
      })
      .filter((item): item is CartItem => item !== null);

    applyCart(normalized);
    if (normalized.length === 0) {
      await AsyncStorage.removeItem(storageKey);
    } else {
      await saveCartToStorage(normalized);
    }
  }, [applyCart, saveCartToStorage, storageKey]);

  const addToCart = useCallback(
    (product: CommerceProduct, variant?: ProductVariant, qty = 1): boolean => {
      const maxStock = stockFor(product, variant);
      if (!product.inStock || !variant?.inStock || maxStock <= 0) {
        Alert.alert('Out of stock', `${product.name} is currently unavailable.`);
        return false;
      }

      if (providerId && providerId !== product.providerId && items.length > 0) {
        Alert.alert(
          'Replace Cart Items?',
          `Your cart contains items from "${providerName ?? 'another shop'}". Clear it and start a new order from "${product.providerName}"?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear & Continue',
              style: 'destructive',
              onPress: () => {
                const quantity = clampQuantity(qty, maxStock);
                const newItems: CartItem[] = [{
                  product,
                  selectedVariant: variant,
                  quantity,
                  unitPrice: variant.price,
                }];
                applyCart(newItems);
                void saveCartToStorage(newItems).catch((error) =>
                  console.warn('Failed to replace stored cart', error),
                );
              },
            },
          ],
        );
        return false;
      }

      setItems((current) => {
        const existingIndex = current.findIndex(
          (item) => item.product.id === product.id && item.selectedVariant?.id === variant.id,
        );
        let next: CartItem[];
        if (existingIndex >= 0) {
          next = [...current];
          const existing = next[existingIndex];
          next[existingIndex] = {
            ...existing,
            product,
            selectedVariant: variant,
            unitPrice: variant.price,
            quantity: Math.min(existing.quantity + Math.max(1, Math.floor(qty)), maxStock),
          };
        } else {
          next = [
            ...current,
            {
              product,
              selectedVariant: variant,
              quantity: clampQuantity(qty, maxStock),
              unitPrice: variant.price,
            },
          ];
        }
        setProviderId(product.providerId);
        setProviderName(product.providerName);
        void saveCartToStorage(next).catch((error) => console.warn('Failed to save cart', error));
        return next;
      });
      return true;
    },
    [applyCart, items.length, providerId, providerName, saveCartToStorage],
  );

  const removeFromCart = useCallback((productId: string, variantId?: string) => {
    setItems((current) => {
      const next = current.filter((item) => !matchesCartLine(item, productId, variantId));
      const first = next[0];
      setProviderId(first?.product.providerId ?? null);
      setProviderName(first?.product.providerName ?? null);
      void (next.length > 0 ? saveCartToStorage(next) : AsyncStorage.removeItem(storageKey)).catch((error) =>
        console.warn('Failed to update stored cart', error),
      );
      return next;
    });
  }, [saveCartToStorage, storageKey]);

  const updateQuantity = useCallback((productId: string, variantId: string | undefined, qty: number) => {
    if (qty <= 0) {
      removeFromCart(productId, variantId);
      return;
    }

    setItems((current) => {
      let updated = false;
      const next = current.map((item) => {
        if (updated || !matchesCartLine(item, productId, variantId)) return item;
        updated = true;
        const maxStock = stockFor(item.product, item.selectedVariant);
        return { ...item, quantity: clampQuantity(qty, maxStock) };
      });
      void saveCartToStorage(next).catch((error) => console.warn('Failed to save quantity', error));
      return next;
    });
  }, [removeFromCart, saveCartToStorage]);

  const revalidateCart = useCallback((): boolean => {
    let valid = true;
    setItems((current) => {
      const next = current.flatMap((item) => {
        const maxStock = stockFor(item.product, item.selectedVariant);
        if (!item.product.inStock || !item.selectedVariant?.inStock || maxStock <= 0) {
          valid = false;
          return [];
        }
        if (item.quantity > maxStock) {
          valid = false;
          return [{ ...item, quantity: maxStock }];
        }
        return [item];
      });
      const first = next[0];
      setProviderId(first?.product.providerId ?? null);
      setProviderName(first?.product.providerName ?? null);
      void (next.length > 0 ? saveCartToStorage(next) : AsyncStorage.removeItem(storageKey)).catch((error) =>
        console.warn('Failed to persist cart revalidation', error),
      );
      return next;
    });
    return valid;
  }, [saveCartToStorage, storageKey]);

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
