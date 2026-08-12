import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  confirmAppointmentHold,
  fetchAvailableAppointmentSlots,
  holdAppointmentSlot,
} from '../appointment-booking';
import * as customerCatalog from '../customer-catalog';
import {
  fetchCommerceProduct,
  fetchCommerceProducts,
  fetchShopProfile,
} from '../customer-catalog';
import {
  createCustomerOrder,
  fetchCheckoutQuote,
  fetchCustomerOrders,
  reorderItems,
} from '../customer-orders';
import { createCustomerPet, fetchCustomerPets } from '../customer-pets';
import { createDefaultAddress, fetchDefaultAddress } from '../customer-profile';
import { fetchActivePromotions } from '../loyalty';
import { fetchProviders } from '../provider-discovery';
import { buildCartFromRevalidation } from '../revalidated-cart';

jest.mock('../provider-discovery', () => ({
  fetchProviders: jest.fn(),
}));

const mockedFetchProviders = fetchProviders as jest.MockedFunction<typeof fetchProviders>;
const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('connected customer services', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    mockedFetch.mockReset();
    mockedFetchProviders.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
    await AsyncStorage.clear();
  });

  it('maps live provider offerings into orderable commerce products', async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            organizationId: '11111111-1111-4111-8111-111111111111',
            outletId: '11111111-1111-4111-8111-111111111111',
            outletName: 'Tirupati Pet Store',
            name: 'Adult Dog Food',
            kind: 'PRODUCT',
            category: 'food',
            mrpPaise: 49900,
            sellingPricePaise: 49900,
            currency: 'INR',
            commerceMode: 'COMMERCE',
            availableQuantity: 12,
            pickupEnabled: true,
            createdAt: new Date().toISOString(),
          },
        ],
        page: 0,
        pageSize: 50,
        hasNext: false,
      }),
    );

    const products = await fetchCommerceProducts({ category: 'food' });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      providerId: '11111111-1111-4111-8111-111111111111',
      category: 'food',
      price: 499,
      inStock: true,
      stockCount: 12,
    });
    expect(products[0].variants[0]).toMatchObject({
      price: 499,
      stockCount: 12,
      inStock: true,
    });
  });

  it('loads a live product and shop profile from public APIs', async () => {
    const listingDetail = {
      id: '22222222-2222-4222-8222-222222222222',
      organizationId: 'org-1',
      outletId: '11111111-1111-4111-8111-111111111111',
      outletName: 'Happy Tails',
      name: 'Chew Toy',
      kind: 'PRODUCT',
      category: 'toys',
      mrpPaise: 29900,
      sellingPricePaise: 29900,
      currency: 'INR',
      commerceMode: 'COMMERCE',
      availableQuantity: 4,
      pickupEnabled: true,
      imageUrls: [],
      createdAt: new Date().toISOString(),
    };

    const outletSummary = {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: 'org-1',
      name: 'Happy Tails',
      capabilities: ['PRODUCT_STORE'],
      pickupEnabled: true,
    };

    mockedFetch.mockResolvedValueOnce(jsonResponse(listingDetail));
    const product = await fetchCommerceProduct(listingDetail.id);
    expect(product.name).toBe('Chew Toy');
    expect(product.providerName).toBe('Happy Tails');

    mockedFetch
      .mockResolvedValueOnce(jsonResponse(outletSummary))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [listingDetail],
          page: 0,
          pageSize: 50,
          hasNext: false,
        }),
      );
    const shop = await fetchShopProfile(outletSummary.id);
    expect(shop.name).toBe('Happy Tails');
    expect(shop.products).toHaveLength(1);
    expect(shop.categories).toEqual(['toys']);
  });

  it('discovers service slots and holds with online payment required', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse([
          {
            offeringId: '33333333-3333-4333-8333-333333333333',
            providerId: '44444444-4444-4444-8444-444444444444',
            name: 'Vet Consultation',
            price: '600.00',
            status: 'ACTIVE',
            durationMinutes: 30,
            stockQuantity: null,
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            slotId: '55555555-5555-4555-8555-555555555555',
            offeringId: '33333333-3333-4333-8333-333333333333',
            slotStart: '2026-08-10T10:00:00Z',
            slotEnd: '2026-08-10T10:30:00Z',
            status: 'AVAILABLE',
          },
        ]),
      );

    const slots = await fetchAvailableAppointmentSlots(
      '44444444-4444-4444-8444-444444444444',
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].price).toBe(600);

    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ appointmentId: '66666666-6666-4666-8666-666666666666' }, 201),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'CONFIRMED' }));

    const appointmentId = await holdAppointmentSlot({
      slot: slots[0],
      userId: '77777777-7777-4777-8777-777777777777',
      petId: '88888888-8888-4888-8888-888888888888',
      accessToken: 'token',
    });
    await confirmAppointmentHold(appointmentId, 'token', '99999999-9999-4999-8999-999999999999');

    expect(appointmentId).toBe('66666666-6666-4666-8666-666666666666');
    expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string)).toMatchObject({
      petId: '88888888-8888-4888-8888-888888888888',
      customerId: '77777777-7777-4777-8777-777777777777',
      payAtClinic: false,
    });
    expect(mockedFetch.mock.calls[3][0]).toContain(
      'paymentId=99999999-9999-4999-8999-999999999999',
    );
  });

  it('reconstructs a validated cart with current live products', async () => {
    const product: customerCatalog.CommerceProduct = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Adult Dog Food',
      brand: 'Royal Canin',
      category: 'food',
      price: 499,
      mrpPaise: 49900,
      sellingPricePaise: 49900,
      inStock: true,
      stockCount: 5,
      availableQuantity: 5,
      imageUrl: 'https://example.com/product.jpg',
      galleryImages: ['https://example.com/product.jpg'],
      description: 'Food',
      createdAt: '2026-08-01T00:00:00Z',
      isNewArrival: true,
      providerId: '11111111-1111-4111-8111-111111111111',
      providerName: 'Tirupati Pet Store',
      organizationId: 'org-1',
      outletId: '11111111-1111-4111-8111-111111111111',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      pickupEnabled: true,
      variants: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Adult Dog Food',
          price: 499,
          inStock: true,
          stockCount: 5,
        },
      ],
      specifications: { Category: 'food', Availability: 'In stock' },
      suitability: ['Dog'],
      sellerInfo: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Tirupati Pet Store',
        pickupEnabled: true,
      },
    };
    jest.spyOn(customerCatalog, 'fetchCommerceProduct').mockResolvedValue(product);

    const cart = await buildCartFromRevalidation({
      originalOrderId: '99999999-9999-4999-8999-999999999999',
      providerId: product.providerId,
      isProviderServiceable: true,
      canReorder: true,
      items: [
        {
          offeringId: product.id,
          offeringName: product.name,
          unitPrice: 499,
          quantity: 2,
          isAvailable: true,
        },
      ],
    });

    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ quantity: 2, unitPrice: 499 });
  });

  it('fetches orders, canonical pickup quotes, reorders and creates orders with server responses', async () => {
    const providerId = '11111111-1111-4111-8111-111111111111';
    const orderId = '99999999-9999-4999-8999-999999999999';
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse([
          {
            orderId,
            providerId,
            status: 'ACCEPTED',
            flowStep: 'placed',
            totalAmount: '548.00',
            placedAt: '2026-08-05T10:00:00Z',
            items: ['Adult Dog Food'],
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ name: 'Tirupati Pet Store' }));

    const orders = await fetchCustomerOrders(
      '77777777-7777-4777-8777-777777777777',
      'token',
    );
    expect(orders[0]).toMatchObject({ id: orderId, providerName: 'Tirupati Pet Store' });

    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customerId: '77777777-7777-4777-8777-777777777777',
        outletId: providerId,
        lines: {
          '22222222-2222-4222-8222-222222222222': [1, 49900],
        },
        cartSignature: 'signed-cart',
        fulfilmentMode: 'STORE_PICKUP',
        paymentMethod: 'PAY_ON_FULFILMENT',
        pricing: {
          itemSubtotalPaise: 49900,
          itemDiscountPaise: 0,
          couponDiscountPaise: 0,
          loyaltyRewardPaise: 0,
          taxPaise: 0,
          platformFeePaise: 1000,
          deliveryFeePaise: 0,
          merchantCommissionPaise: 1000,
          grandTotalPaise: 50900,
          currency: 'INR',
          ruleVersion: 's1-v1',
        },
        expiresAt: '2026-08-05T10:15:00Z',
      }),
    );
    const quote = await fetchCheckoutQuote(
      {
        customerId: '77777777-7777-4777-8777-777777777777',
        providerId,
        deliveryAddressId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        items: [{ offeringId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
        couponCode: 'IGNORED_BY_S1_QUOTE',
        paymentMethod: 'UPI',
      },
      'token',
    );
    expect(quote).toMatchObject({
      quoteToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cartSignature: 'signed-cart',
      fulfilmentMode: 'STORE_PICKUP',
      paymentMethod: 'PAY_ON_FULFILMENT',
      subtotal: 499,
      platformFee: 10,
      deliveryFee: 0,
      payableTotal: 509,
      currency: 'INR',
      ruleVersion: 's1-v1',
    });
    expect(mockedFetch.mock.calls[2][0]).toContain('/api/v1/customer/quotes/pickup');
    expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string)).toEqual({
      outletId: providerId,
      lines: [{ listingId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
    });

    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        originalOrderId: orderId,
        providerId,
        isProviderServiceable: true,
        canReorder: true,
        items: [],
      }),
    );
    expect((await reorderItems(orderId, 'token')).canReorder).toBe(true);

    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse(
          {
            orderId,
            providerId,
            status: 'ACCEPTED',
            totalAmount: 572.95,
            placedAt: '2026-08-05T10:00:00Z',
            items: [{ offeringNameSnapshot: 'Adult Dog Food' }],
            paymentMethod: 'COD',
            paymentStatus: 'COD_PENDING',
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ name: 'Tirupati Pet Store' }));
    const created = await createCustomerOrder(
      {
        customerId: '77777777-7777-4777-8777-777777777777',
        providerId,
        deliveryAddressId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        items: [{ offeringId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
        quoteToken: 'Q-1',
        paymentMethod: 'COD',
      },
      'token',
    );
    expect(created).toMatchObject({ id: orderId, paymentMethod: 'COD' });
  });

  it('falls back to cached orders only for network failures', async () => {
    const customerId = '77777777-7777-4777-8777-777777777777';
    await AsyncStorage.setItem(
      `@mypet_orders_cache_v2_${customerId}`,
      JSON.stringify([
        {
          id: '99999999-9999-4999-8999-999999999999',
          providerId: '11111111-1111-4111-8111-111111111111',
          providerName: 'Cached Store',
          items: ['Cached item'],
          total: '₹100',
          rawTotal: 100,
          status: 'DELIVERED',
          orderedAt: '2026-08-01T00:00:00Z',
          hasReview: false,
          flowStep: 'delivered',
        },
      ]),
    );
    mockedFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    const cached = await fetchCustomerOrders(customerId, 'token');
    expect(cached[0].providerName).toBe('Cached Store');

    mockedFetch.mockResolvedValueOnce(jsonResponse({ error: 'Forbidden' }, 403));
    await expect(fetchCustomerOrders(customerId, 'token')).rejects.toMatchObject({ status: 403 });
  });

  it('uses authenticated pet, address, promotion and wallet APIs', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse([{ petId: 'pet-1', name: 'Bruno', species: 'DOG' }]),
      )
      .mockResolvedValueOnce(
        jsonResponse({ petId: 'pet-2', name: 'Milo', species: 'CAT' }, 201),
      )
      .mockResolvedValueOnce(jsonResponse(null, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          addressId: 'address-1',
          label: 'Home',
          line1: 'Tirupati',
          line2: null,
          city: 'Tirupati',
          state: 'Andhra Pradesh',
          pincode: '517501',
          geoLat: '13.6288',
          geoLng: '79.4192',
          isDefault: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            promotionId: 'promo-expired',
            code: 'OLD',
            discountType: 'FLAT',
            discountValue: 50,
            validFrom: '2025-01-01T00:00:00Z',
            validUntil: '2025-01-02T00:00:00Z',
            isActive: true,
          },
          {
            promotionId: 'promo-live',
            code: 'LIVE10',
            discountType: 'PERCENTAGE',
            discountValue: 10,
            validFrom: '2026-01-01T00:00:00Z',
            validUntil: '2027-01-01T00:00:00Z',
            isActive: true,
          },
        ]),
      );

    expect(await fetchCustomerPets('token')).toHaveLength(1);
    expect((await createCustomerPet({ name: 'Milo', species: 'CAT' }, 'token')).name).toBe('Milo');
    expect(await fetchDefaultAddress('token')).toBeNull();
    const address = await createDefaultAddress('token', {
      label: 'Home',
      line1: 'Tirupati',
      city: 'Tirupati',
      state: 'Andhra Pradesh',
      pincode: '517501',
      geoLat: 13.6288,
      geoLng: 79.4192,
    });
    expect(address.geoLat).toBe(13.6288);
    const promotions = await fetchActivePromotions('token');
    expect(promotions.map((promotion) => promotion.code)).toEqual(['LIVE10']);
  });
});
