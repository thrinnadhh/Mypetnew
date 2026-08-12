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
    mockedFetchProviders.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Tirupati Pet Store',
        description: 'Verified local store',
        distanceKm: 2.5,
        rating: 4.7,
        ratingCount: 38,
      },
    ]);
    mockedFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          offeringId: '22222222-2222-4222-8222-222222222222',
          providerId: '11111111-1111-4111-8111-111111111111',
          name: 'Adult Dog Food',
          description: 'Balanced nutrition',
          category: 'Food & Nutrition',
          price: '499.00',
          status: 'ACTIVE',
          stockQuantity: 12,
          sku: 'DOG-FOOD-1',
          createdAt: new Date().toISOString(),
        },
      ]),
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
    const offering = {
      offeringId: '22222222-2222-4222-8222-222222222222',
      providerId: '11111111-1111-4111-8111-111111111111',
      name: 'Chew Toy',
      description: 'Durable toy',
      category: 'Toys',
      price: 299,
      status: 'ACTIVE',
      stockQuantity: 4,
    };
    const provider = {
      providerId: offering.providerId,
      providerType: 'PET_STORE',
      fulfillmentType: 'DELIVERY',
      name: 'Happy Tails',
      description: 'Local store',
      city: 'Tirupati',
      status: 'ACTIVE',
      ratingAvg: '4.8',
      ratingCount: 25,
    };

    mockedFetch
      .mockResolvedValueOnce(jsonResponse(offering))
      .mockResolvedValueOnce(jsonResponse(provider));
    const product = await fetchCommerceProduct(offering.offeringId);
    expect(product.name).toBe('Chew Toy');
    expect(product.providerName).toBe('Happy Tails');

    mockedFetch
      .mockResolvedValueOnce(jsonResponse(provider))
      .mockResolvedValueOnce(jsonResponse([offering]));
    const shop = await fetchShopProfile(provider.providerId);
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
    const product = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Adult Dog Food',
      brand: 'Store',
      category: 'food',
      price: 499,
      rating: '4.8 ★',
      reviewCount: 1,
      deliveryTime: 'Same-day delivery',
      inStock: true,
      stockCount: 5,
      imageUrl: 'https://example.com/product.jpg',
      galleryImages: ['https://example.com/product.jpg'],
      description: 'Food',
      createdAt: '2026-08-01T00:00:00Z',
      isNewArrival: true,
      providerId: '11111111-1111-4111-8111-111111111111',
      providerName: 'Store',
      variants: [
        {
          id: '22222222-2222-4222-8222-222222222222:default',
          name: 'Standard',
          price: 499,
          inStock: true,
          stockCount: 5,
        },
      ],
      specifications: {},
      suitability: ['Pets'],
      sellerInfo: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Store',
        address: 'Tirupati',
        verified: true,
        rating: '4.8 ★',
      },
      deliveryEstimate: 'Same day',
      returnPolicy: 'Seller policy',
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

  it('fetches orders, quotes, reorders and creates orders with server responses', async () => {
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
        quoteToken: 'Q-1',
        subtotal: 499,
        itemDiscount: 0,
        couponDiscount: 0,
        loyaltyDiscount: 0,
        deliveryFee: 49,
        tax: 24.95,
        roundOff: 0,
        payableTotal: 572.95,
        isCodAvailable: true,
        expiresAt: '2026-08-05T10:15:00Z',
      }),
    );
    const quote = await fetchCheckoutQuote(
      {
        customerId: '77777777-7777-4777-8777-777777777777',
        providerId,
        deliveryAddressId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        items: [{ offeringId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
      },
      'token',
    );
    expect(quote.quoteToken).toBe('Q-1');

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