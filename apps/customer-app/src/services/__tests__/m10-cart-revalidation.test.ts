import type { CartItem } from '@/context/CartContext';
import { revalidateCartItemsAgainstCatalog } from '../cart-revalidation';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

const mockedFetch = jest.fn();

function cartItem(id: string, price: number, quantity: number, stock = 5): CartItem {
  const variant = { id, name: '1 pack', price, inStock: stock > 0, stockCount: stock };
  return {
    product: {
      id,
      name: `Cached ${id}`,
      category: 'food',
      price,
      inStock: stock > 0,
      stockCount: stock,
      availableQuantity: stock,
      galleryImages: [],
      createdAt: '2026-08-01T00:00:00Z',
      isNewArrival: true,
      providerId: '11111111-1111-4111-8111-111111111111',
      providerName: 'Canonical Store',
      organizationId: '22222222-2222-4222-8222-222222222222',
      outletId: '11111111-1111-4111-8111-111111111111',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      pickupEnabled: true,
      variants: [variant],
      specifications: {},
      suitability: [],
    },
    selectedVariant: variant,
    quantity,
    unitPrice: price,
  };
}

function canonical(id: string, sellingPricePaise: number, availableQuantity: number) {
  return {
    id,
    organizationId: '22222222-2222-4222-8222-222222222222',
    outletId: '11111111-1111-4111-8111-111111111111',
    outletName: 'Canonical Store',
    name: `Canonical ${id}`,
    kind: 'PRODUCT',
    category: 'food',
    brand: 'MyPet',
    petType: 'dog',
    lifeStage: 'adult',
    packLabel: '1 pack',
    sku: `SKU-${id}`,
    mrpPaise: 20_000,
    sellingPricePaise,
    currency: 'INR',
    commerceMode: 'COMMERCE',
    availableQuantity,
    pickupEnabled: true,
    primaryImageUrl: 'https://cdn.example.test/new.jpg',
    createdAt: '2026-08-01T00:00:00Z',
    description: 'Canonical committed metadata',
    imageUrls: ['https://cdn.example.test/new.jpg'],
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

describe('M10 cart revalidation', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('uses one bounded batch request and adopts canonical price stock and metadata', async () => {
    const first = cartItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 90, 3);
    const second = cartItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 75, 1);
    mockedFetch.mockResolvedValueOnce(response({
      outletId: first.product.providerId,
      pincode: '517501',
      materialChanged: true,
      checkoutAllowed: true,
      lines: [
        {
          listingId: first.product.id,
          requestedQuantity: 3,
          acceptedQuantity: 2,
          changes: ['PRICE_CHANGED', 'QUANTITY_REDUCED'],
          canonical: canonical(first.product.id, 8_500, 2),
        },
        {
          listingId: second.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 1,
          changes: [],
          canonical: canonical(second.product.id, 7_500, 4),
        },
      ],
    }));

    const result = await revalidateCartItemsAgainstCatalog([first, second], '517501');

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(String(mockedFetch.mock.calls[0][0])).toContain('/api/v1/public/cart/revalidate');
    expect(result).toMatchObject({
      materialChanged: true,
      removedCount: 0,
      priceChangedCount: 1,
      quantityChangedCount: 1,
    });
    expect(result.items[0]).toMatchObject({ quantity: 2, unitPrice: 85 });
    expect(result.items[0].product).toMatchObject({
      name: `Canonical ${first.product.id}`,
      availableQuantity: 2,
      description: 'Canonical committed metadata',
      imageUrl: 'https://cdn.example.test/new.jpg',
    });
  });

  it('removes only unavailable lines without clearing still-valid cart contents', async () => {
    const first = cartItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 90, 1);
    const second = cartItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 75, 1);
    mockedFetch.mockResolvedValueOnce(response({
      outletId: first.product.providerId,
      pincode: '517501',
      materialChanged: true,
      checkoutAllowed: false,
      lines: [
        {
          listingId: first.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 0,
          changes: ['PRODUCT_UNAVAILABLE'],
          canonical: null,
        },
        {
          listingId: second.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 1,
          changes: [],
          canonical: canonical(second.product.id, 7_500, 4),
        },
      ],
    }));

    const result = await revalidateCartItemsAgainstCatalog([first, second], '517501');

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(result.removedCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].product.id).toBe(second.product.id);
  });

  it('fails closed when the batch duplicates one line and omits another', async () => {
    const first = cartItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 90, 1);
    const second = cartItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 75, 1);
    mockedFetch.mockResolvedValueOnce(response({
      outletId: first.product.providerId,
      pincode: '517501',
      materialChanged: false,
      checkoutAllowed: true,
      lines: [
        {
          listingId: first.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 1,
          changes: [],
          canonical: canonical(first.product.id, 9_000, 4),
        },
        {
          listingId: first.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 1,
          changes: [],
          canonical: canonical(first.product.id, 9_000, 4),
        },
      ],
    }));

    await expect(revalidateCartItemsAgainstCatalog([first, second], '517501'))
      .rejects.toThrow('inconsistent product line set');
  });

  it('fails closed on canonical identity substitution', async () => {
    const first = cartItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 90, 1);
    const foreignId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mockedFetch.mockResolvedValueOnce(response({
      outletId: first.product.providerId,
      pincode: '517501',
      materialChanged: false,
      checkoutAllowed: true,
      lines: [
        {
          listingId: first.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 1,
          changes: [],
          canonical: canonical(foreignId, 9_000, 4),
        },
      ],
    }));

    await expect(revalidateCartItemsAgainstCatalog([first], '517501'))
      .rejects.toThrow('mismatched canonical product data');
  });

  it('fails closed on quantity inflation or request echo drift', async () => {
    const first = cartItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 90, 1);
    mockedFetch.mockResolvedValueOnce(response({
      outletId: first.product.providerId,
      pincode: '517501',
      materialChanged: false,
      checkoutAllowed: true,
      lines: [
        {
          listingId: first.product.id,
          requestedQuantity: 1,
          acceptedQuantity: 2,
          changes: [],
          canonical: canonical(first.product.id, 9_000, 4),
        },
      ],
    }));

    await expect(revalidateCartItemsAgainstCatalog([first], '517501'))
      .rejects.toThrow('invalid cart quantities');
  });

  it('fails before network for mixed-outlet and oversized carts', async () => {
    const first = cartItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 90, 1);
    const foreign = cartItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 75, 1);
    foreign.product.providerId = '33333333-3333-4333-8333-333333333333';
    foreign.product.outletId = foreign.product.providerId;

    await expect(revalidateCartItemsAgainstCatalog([first, foreign], '517501')).rejects.toThrow('more than one store');
    const oversized = Array.from({ length: 51 }, (_, index) =>
      cartItem(`${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, 90, 1),
    );
    await expect(revalidateCartItemsAgainstCatalog(oversized, '517501')).rejects.toThrow('too large');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
