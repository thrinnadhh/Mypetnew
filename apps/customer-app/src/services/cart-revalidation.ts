import type { CartItem } from '@/context/CartContext';
import { apiClient } from '@/services/api-client';
import { isCommerceEligible } from '@/services/commerce-eligibility';
import {
  mapListingToCommerceProduct,
  type PublicListingDetail,
} from '@/services/customer-catalog';
import { fetchServiceableCommerceProduct } from '@/services/paginated-catalog';
import { appConfig } from '@/utils/app-config';

export interface CartRevalidationResult {
  items: CartItem[];
  materialChanged: boolean;
  removedCount: number;
  priceChangedCount: number;
  quantityChangedCount: number;
}

type CartRevalidationChange =
  | 'PRICE_CHANGED'
  | 'QUANTITY_REDUCED'
  | 'PRODUCT_UNAVAILABLE'
  | 'STORE_UNAVAILABLE'
  | 'SERVICEABILITY_CHANGED';

interface CartRevalidationLineDto {
  listingId: string;
  requestedQuantity: number;
  acceptedQuantity: number;
  changes: CartRevalidationChange[];
  canonical: PublicListingDetail | null;
}

interface CartRevalidationResponseDto {
  outletId: string;
  pincode: string;
  lines: CartRevalidationLineDto[];
  materialChanged: boolean;
  checkoutAllowed: boolean;
}

const ALLOWED_REVALIDATION_CHANGES = new Set<CartRevalidationChange>([
  'PRICE_CHANGED',
  'QUANTITY_REDUCED',
  'PRODUCT_UNAVAILABLE',
  'STORE_UNAVAILABLE',
  'SERVICEABILITY_CHANGED',
]);

function requireServicePincode(pincode: string): string {
  const normalized = pincode.trim();
  if (!/^[1-9][0-9]{5}$/.test(normalized)) {
    throw new Error('Select a valid service PIN before refreshing the cart.');
  }
  return normalized;
}

function normalizeRequestedQuantity(quantity: number): number {
  return Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
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
    return liveProduct.variants.find((variant) => variant.id === requestedVariantId)
      ?? liveProduct.variants[0]
      ?? null;
  }
  return liveProduct.variants[0] ?? null;
}

function validateSingleOutlet(currentItems: readonly CartItem[]): string {
  const expectedProviderId = currentItems[0].product.providerId;
  if (!expectedProviderId || currentItems.some((item) => item.product.providerId !== expectedProviderId)) {
    throw new Error('The cart contains items from more than one store and must be reviewed.');
  }
  return expectedProviderId;
}

function validateBatchResponse(
  response: CartRevalidationResponseDto,
  currentById: ReadonlyMap<string, CartItem>,
  expectedProviderId: string,
): void {
  if (!Array.isArray(response.lines) || response.lines.length !== currentById.size) {
    throw new Error('Cart service returned an incomplete revalidation result.');
  }

  const seen = new Set<string>();
  for (const line of response.lines) {
    if (!line || typeof line.listingId !== 'string' || !currentById.has(line.listingId) || seen.has(line.listingId)) {
      throw new Error('Cart service returned an inconsistent product line set.');
    }
    seen.add(line.listingId);

    const current = currentById.get(line.listingId)!;
    const requestedQuantity = normalizeRequestedQuantity(current.quantity);
    if (
      !Number.isInteger(line.requestedQuantity)
      || line.requestedQuantity !== requestedQuantity
      || !Number.isInteger(line.acceptedQuantity)
      || line.acceptedQuantity < 0
      || line.acceptedQuantity > requestedQuantity
    ) {
      throw new Error('Cart service returned invalid cart quantities.');
    }
    if (!Array.isArray(line.changes) || line.changes.some((change) => !ALLOWED_REVALIDATION_CHANGES.has(change))) {
      throw new Error('Cart service returned an invalid cart change result.');
    }

    const canonical = line.canonical;
    if (line.acceptedQuantity > 0 && canonical == null) {
      throw new Error('Cart service omitted canonical product data for an accepted line.');
    }
    if (canonical != null && (canonical.id !== line.listingId || canonical.outletId !== expectedProviderId)) {
      throw new Error('Cart service returned mismatched canonical product data.');
    }
  }

  if (seen.size !== currentById.size) {
    throw new Error('Cart service returned an incomplete revalidation result.');
  }
}

async function revalidateDemoCart(
  currentItems: readonly CartItem[],
  servicePincode: string,
): Promise<CartRevalidationResult> {
  const expectedProviderId = validateSingleOutlet(currentItems);
  const refreshed: CartItem[] = [];
  let removedCount = 0;
  let priceChangedCount = 0;
  let quantityChangedCount = 0;

  for (const current of currentItems) {
    let liveProduct;
    try {
      liveProduct = await fetchServiceableCommerceProduct(current.product.id, servicePincode);
    } catch {
      removedCount += 1;
      continue;
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
    const candidate: CartItem = { product: liveProduct, selectedVariant, quantity: current.quantity, unitPrice: selectedVariant.price };
    const stock = maxKnownStock(candidate);
    if (stock <= 0) {
      removedCount += 1;
      continue;
    }
    const requestedQuantity = normalizeRequestedQuantity(current.quantity);
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

export async function revalidateCartItemsAgainstCatalog(
  currentItems: readonly CartItem[],
  pincode: string,
): Promise<CartRevalidationResult> {
  const servicePincode = requireServicePincode(pincode);
  if (currentItems.length === 0) {
    return { items: [], materialChanged: false, removedCount: 0, priceChangedCount: 0, quantityChangedCount: 0 };
  }
  const expectedProviderId = validateSingleOutlet(currentItems);
  if (appConfig.allowDemoMode) return revalidateDemoCart(currentItems, servicePincode);
  if (currentItems.length > 50) {
    throw new Error('The cart is too large to refresh safely. Review and reduce the cart before checkout.');
  }

  const currentById = new Map(currentItems.map((item) => [item.product.id, item]));
  if (currentById.size !== currentItems.length) {
    throw new Error('The cart contains duplicate product lines and must be reviewed.');
  }

  const response = await apiClient.post<CartRevalidationResponseDto>(
    '/api/v1/public/cart/revalidate',
    {
      outletId: expectedProviderId,
      pincode: servicePincode,
      lines: currentItems.map((item) => ({
        listingId: item.product.id,
        quantity: normalizeRequestedQuantity(item.quantity),
        observedUnitPricePaise: Math.round(item.unitPrice * 100),
      })),
    },
  );
  if (response.outletId !== expectedProviderId || response.pincode !== servicePincode) {
    throw new Error('Cart service returned an inconsistent store or serviceability scope.');
  }
  validateBatchResponse(response, currentById, expectedProviderId);

  const refreshed: CartItem[] = [];
  let removedCount = 0;
  let priceChangedCount = 0;
  let quantityChangedCount = 0;
  for (const line of response.lines) {
    const current = currentById.get(line.listingId)!;
    const canonical = line.canonical;
    if (
      line.acceptedQuantity <= 0
      || canonical == null
      || line.changes.includes('PRODUCT_UNAVAILABLE')
      || line.changes.includes('STORE_UNAVAILABLE')
      || line.changes.includes('SERVICEABILITY_CHANGED')
    ) {
      removedCount += 1;
      continue;
    }

    const liveProduct = mapListingToCommerceProduct(canonical);
    if (liveProduct.id !== line.listingId || liveProduct.providerId !== expectedProviderId || !isCommerceEligible(liveProduct)) {
      throw new Error('Cart service returned mismatched canonical product data.');
    }
    const selectedVariant = variantForCurrentListing(current, liveProduct);
    if (!selectedVariant?.inStock || line.acceptedQuantity > selectedVariant.stockCount) {
      removedCount += 1;
      continue;
    }
    if (line.changes.includes('PRICE_CHANGED') || selectedVariant.price !== current.unitPrice) priceChangedCount += 1;
    if (line.changes.includes('QUANTITY_REDUCED') || line.acceptedQuantity !== current.quantity) quantityChangedCount += 1;
    refreshed.push({ product: liveProduct, selectedVariant, quantity: line.acceptedQuantity, unitPrice: selectedVariant.price });
  }

  return {
    items: refreshed,
    materialChanged: response.materialChanged || removedCount > 0 || priceChangedCount > 0 || quantityChangedCount > 0,
    removedCount,
    priceChangedCount,
    quantityChangedCount,
  };
}
