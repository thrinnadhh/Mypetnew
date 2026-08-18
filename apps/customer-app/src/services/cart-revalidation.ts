import type { CartItem } from '@/context/CartContext';
import { apiErrorKind } from '@/contracts/api-error';
import { isCommerceEligible } from '@/services/commerce-eligibility';
import { fetchServiceableCommerceProduct } from '@/services/paginated-catalog';

export interface CartRevalidationResult {
  items: CartItem[];
  materialChanged: boolean;
  removedCount: number;
  priceChangedCount: number;
  quantityChangedCount: number;
}

function requireServicePincode(pincode: string): string {
  const normalized = pincode.trim();
  if (!/^[1-9][0-9]{5}$/.test(normalized)) {
    throw new Error('Select a valid service PIN before refreshing the cart.');
  }
  return normalized;
}

function maxKnownStock(item: CartItem): number {
  const productStock = item.product.availableQuantity ?? item.product.stockCount;
  const variantStock = item.selectedVariant?.stockCount ?? productStock;
  if (!Number.isFinite(productStock) || !Number.isFinite(variantStock)) return 0;
  return Math.max(0, Math.min(Math.floor(productStock), Math.floor(variantStock)));
}

function variantForCurrentListing(current: CartItem, liveProduct: CartItem['product']) {
  const requestedVariantId = current.selectedVariant?.id;
  if (requestedVariantId) {
    return liveProduct.variants.find((variant) => variant.id === requestedVariantId) ?? null;
  }
  return liveProduct.variants[0] ?? null;
}

export async function revalidateCartItemsAgainstCatalog(
  currentItems: readonly CartItem[],
  pincode: string,
): Promise<CartRevalidationResult> {
  const servicePincode = requireServicePincode(pincode);
  if (currentItems.length === 0) {
    return {
      items: [],
      materialChanged: false,
      removedCount: 0,
      priceChangedCount: 0,
      quantityChangedCount: 0,
    };
  }

  const expectedProviderId = currentItems[0].product.providerId;
  if (currentItems.some((item) => item.product.providerId !== expectedProviderId)) {
    throw new Error('The cart contains items from more than one store and must be reviewed.');
  }

  const refreshed: CartItem[] = [];
  let removedCount = 0;
  let priceChangedCount = 0;
  let quantityChangedCount = 0;

  for (const current of currentItems) {
    let liveProduct;
    try {
      liveProduct = await fetchServiceableCommerceProduct(current.product.id, servicePincode);
    } catch (error) {
      if (apiErrorKind(error) === 'not-found') {
        removedCount += 1;
        continue;
      }
      throw error;
    }

    if (liveProduct.providerId !== expectedProviderId || !isCommerceEligible(liveProduct)) {
      removedCount += 1;
      continue;
    }

    const selectedVariant = variantForCurrentListing(current, liveProduct);
    if (!selectedVariant?.inStock || selectedVariant.stockCount <= 0) {
      removedCount += 1;
      continue;
    }

    const candidate: CartItem = {
      product: liveProduct,
      selectedVariant,
      quantity: current.quantity,
      unitPrice: selectedVariant.price,
    };
    const stock = maxKnownStock(candidate);
    if (stock <= 0) {
      removedCount += 1;
      continue;
    }

    const requestedQuantity = Number.isFinite(current.quantity)
      ? Math.max(1, Math.floor(current.quantity))
      : 1;
    const quantity = Math.min(requestedQuantity, stock);
    if (quantity !== current.quantity) quantityChangedCount += 1;
    if (selectedVariant.price !== current.unitPrice) priceChangedCount += 1;

    refreshed.push({ ...candidate, quantity });
  }

  return {
    items: refreshed,
    materialChanged: removedCount > 0 || priceChangedCount > 0 || quantityChangedCount > 0,
    removedCount,
    priceChangedCount,
    quantityChangedCount,
  };
}
