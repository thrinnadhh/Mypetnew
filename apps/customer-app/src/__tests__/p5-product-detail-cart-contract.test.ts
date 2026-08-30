import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mergeSameProviderCartItems,
  sanitizeStoredCartItems,
  type CartItem,
} from '../context/CartContext';
import type { CommerceProduct } from '../services/catalog-types';
import { revalidateCartItemsAgainstCatalog } from '../services/cart-revalidation';

const mockedFetch = jest.fn();

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function rootSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), '..', '..', relativePath), 'utf8');
}

function product(overrides: Partial<CommerceProduct> = {}): CommerceProduct {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Live Dog Food',
    category: 'food',
    price: 100,
    mrpPaise: 12000,
    sellingPricePaise: 10000,
    inStock: true,
    stockCount: 5,
    availableQuantity: 5,
    galleryImages: ['https://example.com/a.jpg'],
    description: 'Current listing description',
    createdAt: '2026-08-18T00:00:00Z',
    isNewArrival: false,
    providerId: '22222222-2222-4222-8222-222222222222',
    providerName: 'Tirupati Pet Store',
    organizationId: '33333333-3333-4333-8333-333333333333',
    outletId: '22222222-2222-4222-8222-222222222222',
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    pickupEnabled: true,
    variants: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '1 kg',
        price: 100,
        inStock: true,
        stockCount: 5,
      },
    ],
    specifications: {},
    suitability: [],
    ...overrides,
  };
}

function line(currentProduct = product(), quantity = 1, unitPrice = currentProduct.variants[0].price): CartItem {
  return {
    product: currentProduct,
    selectedVariant: currentProduct.variants[0],
    quantity,
    unitPrice,
  };
}

function canonical(currentProduct: CommerceProduct) {
  return {
    id: currentProduct.id,
    organizationId: currentProduct.organizationId,
    outletId: currentProduct.outletId,
    outletName: currentProduct.providerName,
    name: currentProduct.name,
    kind: currentProduct.kind,
    category: currentProduct.category,
    brand: currentProduct.brand ?? null,
    petType: currentProduct.petType ?? null,
    lifeStage: currentProduct.lifeStage ?? null,
    packLabel: currentProduct.variants[0]?.name ?? null,
    sku: null,
    mrpPaise: currentProduct.mrpPaise ?? Math.round(currentProduct.price * 100),
    sellingPricePaise: currentProduct.sellingPricePaise ?? Math.round(currentProduct.price * 100),
    currency: 'INR',
    commerceMode: currentProduct.commerceMode,
    availableQuantity: currentProduct.availableQuantity ?? currentProduct.stockCount,
    pickupEnabled: currentProduct.pickupEnabled,
    primaryImageUrl: currentProduct.galleryImages[0] ?? null,
    createdAt: currentProduct.createdAt,
    description: currentProduct.description ?? null,
    imageUrls: currentProduct.galleryImages,
  };
}

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function mockBatchResult(
  currentProduct: CommerceProduct,
  requestedQuantity: number,
  acceptedQuantity: number,
  changes: string[],
  canonicalProduct: ReturnType<typeof canonical> | null,
  materialChanged = changes.length > 0,
): void {
  mockedFetch.mockResolvedValueOnce(response({
    outletId: currentProduct.providerId,
    pincode: '517501',
    materialChanged,
    checkoutAllowed: acceptedQuantity > 0,
    lines: [{
      listingId: currentProduct.id,
      requestedQuantity,
      acceptedQuantity,
      changes,
      canonical: canonicalProduct,
    }],
  }));
}

describe('P5 product detail + cart contract', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  describe('persisted cart safety', () => {
    it('drops medicine and VIEW_ONLY lines instead of restoring them into a transactional cart', () => {
      const medicine = line(product({ kind: 'MEDICINE', commerceMode: 'VIEW_ONLY' }));
      const result = sanitizeStoredCartItems([medicine]);
      expect(result.changed).toBe(true);
      expect(result.items).toEqual([]);
    });

    it('derives display price from the canonical stored variant rather than a tampered unitPrice', () => {
      const result = sanitizeStoredCartItems([line(product(), 2, 0.01)]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].unitPrice).toBe(100);
      expect(result.changed).toBe(true);
    });

    it('drops non-finite persisted quantities instead of restoring a ghost row', () => {
      const result = sanitizeStoredCartItems([line(product(), Number.NaN)]);
      expect(result.changed).toBe(true);
      expect(result.items).toEqual([]);
    });

    it('fails closed on an illegally persisted second merchant', () => {
      const second = product({
        id: '44444444-4444-4444-8444-444444444444',
        providerId: '55555555-5555-4555-8555-555555555555',
        outletId: '55555555-5555-4555-8555-555555555555',
        providerName: 'Another Store',
        variants: [{
          id: '44444444-4444-4444-8444-444444444444',
          name: '1 kg',
          price: 80,
          inStock: true,
          stockCount: 5,
        }],
      });
      const result = sanitizeStoredCartItems([line(), line(second)]);
      expect(result.changed).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].product.providerId).toBe('22222222-2222-4222-8222-222222222222');
    });

    it('merges guest and authenticated carts only when they belong to the same merchant', () => {
      const merged = mergeSameProviderCartItems([line(product(), 2)], [line(product(), 2)]);
      expect(merged).toHaveLength(1);
      expect(merged[0].quantity).toBe(4);
    });
  });

  describe('live cart revalidation before checkout handoff', () => {
    it('refreshes a stale price and clamps quantity to current stock through one canonical batch request', async () => {
      const cached = product();
      const live = product({
        price: 125,
        sellingPricePaise: 12500,
        stockCount: 2,
        availableQuantity: 2,
        variants: [{
          id: '11111111-1111-4111-8111-111111111111',
          name: '1 kg',
          price: 125,
          inStock: true,
          stockCount: 2,
        }],
      });
      mockBatchResult(cached, 5, 2, ['PRICE_CHANGED', 'QUANTITY_REDUCED'], canonical(live));

      const result = await revalidateCartItemsAgainstCatalog([line(cached, 5, 100)], '517501');

      expect(result.materialChanged).toBe(true);
      expect(result.priceChangedCount).toBe(1);
      expect(result.quantityChangedCount).toBe(1);
      expect(result.items[0].unitPrice).toBe(125);
      expect(result.items[0].quantity).toBe(2);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(String(mockedFetch.mock.calls[0][0])).toContain('/api/v1/public/cart/revalidate');
    });

    it('normalizes a non-finite in-memory quantity before checkout handoff', async () => {
      const live = product();
      mockBatchResult(live, 1, 1, [], canonical(live), false);
      const result = await revalidateCartItemsAgainstCatalog([line(live, Number.NaN)], '517501');
      expect(result.materialChanged).toBe(true);
      expect(result.quantityChangedCount).toBe(1);
      expect(result.items[0].quantity).toBe(1);
    });

    it('removes a listing that became VIEW_ONLY instead of allowing checkout handoff', async () => {
      const cached = product();
      mockBatchResult(cached, 1, 0, ['PRODUCT_UNAVAILABLE'], null);
      const result = await revalidateCartItemsAgainstCatalog([line(cached)], '517501');
      expect(result.materialChanged).toBe(true);
      expect(result.removedCount).toBe(1);
      expect(result.items).toEqual([]);
    });

    it('removes a product that is no longer public or serviceable without leaking why', async () => {
      const cached = product();
      mockBatchResult(cached, 1, 0, ['SERVICEABILITY_CHANGED'], null);
      const result = await revalidateCartItemsAgainstCatalog([line(cached)], '517501');
      expect(result.removedCount).toBe(1);
      expect(result.items).toEqual([]);
    });

    it('keeps caller state recoverable when live revalidation fails for a network error', async () => {
      mockedFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
      await expect(revalidateCartItemsAgainstCatalog([line()], '517501')).rejects.toThrow('Network request failed');
    });
  });

  describe('screen and authority boundaries', () => {
    it('keeps product detail race-safe, gallery-aware, recoverable and navigable to cart', () => {
      const detail = source('src/app/commerce/product-detail.tsx');
      expect(detail).toContain('requestGeneration');
      expect(detail).toContain("'not-found'");
      expect(detail).toContain("'unavailable'");
      expect(detail).toContain('apiErrorKind(error)');
      expect(detail).toContain('galleryImages');
      expect(detail).toContain('Show product image');
      expect(detail).toContain('ResilientRemoteImage');
      expect(detail).toContain('disabled={unavailable}');
      expect(detail).toContain('disabled={atKnownMax}');
      expect(detail).toContain('accessibilityValue={{ min: 1, max: maxStock, now: quantity }}');
      expect(detail).toContain('adjustQuantity(product.id, selectedVariant.id, -1)');
      expect(detail).toContain('adjustQuantity(product.id, selectedVariant.id, 1)');
      expect(detail).toContain('label="View Cart"');
      expect(detail).toContain('router.canGoBack()');
      expect(detail).toContain("router.replace('/products'");
      expect(detail).toContain('useSafeAreaInsets');
      expect(detail).toContain('insets.bottom');
      expect(detail).toContain('favouritePending');
      expect(detail).toContain('busy: favouritePending');
      expect(detail).not.toContain('SAMPLE_PRODUCTS');
    });

    it('shows only a cart subtotal projection and leaves fee/final pricing to the quote', () => {
      const cart = source('src/app/cart/index.tsx');
      expect(cart).toContain('Current item subtotal');
      expect(cart).toContain('projection only');
      expect(cart).toContain('authoritative checkout quote');
      expect(cart).toContain('revalidateCartItemsAgainstCatalog');
      expect(cart).toContain("router.push('/checkout'");
      expect(cart).toContain('ResilientRemoteImage');
      expect(cart).toContain('accessibilityValue={{ min: 1, max: maxStock, now: item.quantity }}');
      expect(cart).toContain('adjustQuantity(item.product.id, item.selectedVariant?.id, -1)');
      expect(cart).toContain('adjustQuantity(item.product.id, item.selectedVariant?.id, 1)');
      expect(cart).toContain('cart stock snapshot');
      expect(cart).toContain('useSafeAreaInsets');
      expect(cart).toContain('insets.bottom');
      expect(cart).not.toMatch(/const\s+deliveryFee|const\s+grandTotal|Delivery Fee|Total Amount/);
    });

    it('guards rapid cart mutations, identity transitions and checkout revalidation races', () => {
      const cartContext = source('src/context/CartContext.tsx');
      const cart = source('src/app/cart/index.tsx');
      expect(cartContext).toContain('itemsRef.current');
      expect(cartContext).toContain('writeQueueRef.current');
      expect(cartContext).toContain('await writeQueueRef.current');
      expect(cartContext).toContain('const adjustQuantity = useCallback');
      expect(cartContext).toContain('item.quantity + normalizedDelta');
      expect(cartContext).toContain("'Replace Cart Items?'");
      expect(cartContext).toContain("'Choose your cart'");
      expect(cart).toContain('checkoutGeneration');
      expect(cart).toContain('disabled={checkingCart}');
      expect(cart).toContain('checkoutGeneration.current !== generation');
    });

    it('keeps server quote/order paths authoritative for price, stock and medicine commerce rules', () => {
      const pickup = rootSource('backend/src/main/kotlin/in/mypetnew/application/web/SprintOneControllers.kt');
      const delivery = rootSource('backend/src/main/kotlin/in/mypetnew/application/web/DeliveryControllers.kt');

      expect(pickup).toContain('listing.commerceMode != CommerceMode.COMMERCE');
      expect(pickup).toContain('inventory.available(listing.id) < line.quantity');
      expect(pickup).toContain('listing.id to Pair(line.quantity, listing.sellingPricePaise)');
      expect(pickup).toContain('listing.sellingPricePaise != quotedUnitPrice');
      expect(delivery).toContain('listing.commerceMode != CommerceMode.COMMERCE');
      expect(delivery).toContain('inventory.available(listing.id) < line.quantity');
      expect(delivery).toContain('listing.id to Pair(line.quantity, listing.sellingPricePaise)');
    });
  });
});
