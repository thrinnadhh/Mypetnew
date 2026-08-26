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
import { createCustomerPet, fetchCustomerPets } from '../customer-pets';
import { createDefaultAddress, fetchDefaultAddress } from '../customer-profile';
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

  it('discovers canonical service slots and creates an idempotent Pay at Provider hold', async () => {
  mockedFetch
    .mockResolvedValueOnce(
      jsonResponse({
        items: [{
          serviceId: '33333333-3333-4333-8333-333333333333',
          outletId: '44444444-4444-4444-8444-444444444444',
          capability: 'VETERINARY',
          name: 'Vet Consultation',
          description: 'General consultation',
          durationMinutes: 30,
          pricePaise: 60000,
          currency: 'INR',
        }],
        page: 0,
        pageSize: 100,
        hasNext: false,
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        items: [{
          slotId: '55555555-5555-4555-8555-555555555555',
          serviceId: '33333333-3333-4333-8333-333333333333',
          startsAt: '2026-08-20T10:00:00Z',
          endsAt: '2026-08-20T10:30:00Z',
        }],
        page: 0,
        pageSize: 100,
        hasNext: false,
      }),
    );

  const slots = await fetchAvailableAppointmentSlots(
    '44444444-4444-4444-8444-444444444444',
  );
  expect(slots).toHaveLength(1);
  expect(slots[0]).toMatchObject({
    id: '55555555-5555-4555-8555-555555555555',
    offeringId: '33333333-3333-4333-8333-333333333333',
    price: 600,
  });
  expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/public/services?');
  expect(mockedFetch.mock.calls[0][0]).toContain('outletId=44444444-4444-4444-8444-444444444444');
  expect(mockedFetch.mock.calls[1][0]).toContain('/availability?');

  mockedFetch
    .mockResolvedValueOnce(
      jsonResponse({ appointmentId: '66666666-6666-4666-8666-666666666666' }, 201),
    )
    .mockResolvedValueOnce(jsonResponse({ status: 'BOOKED' }));

  const appointmentId = await holdAppointmentSlot({
    slot: slots[0],
    userId: '77777777-7777-4777-8777-777777777777',
    petId: '88888888-8888-4888-8888-888888888888',
    pincode: '517501',
    accessToken: 'token',
  });
  await confirmAppointmentHold(appointmentId, 'token');

  expect(appointmentId).toBe('66666666-6666-4666-8666-666666666666');
  expect(mockedFetch.mock.calls[2][0]).toContain('/api/v1/customer/appointments');
  expect(mockedFetch.mock.calls[2][1]?.headers).toMatchObject({
    Authorization: 'Bearer token',
    'Idempotency-Key': 'appointment-v2-55555555-5555-4555-8555-555555555555-88888888-8888-4888-8888-888888888888-517501',
  });
  expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string)).toEqual({
    outletId: '44444444-4444-4444-8444-444444444444',
    serviceId: '33333333-3333-4333-8333-333333333333',
    slotId: '55555555-5555-4555-8555-555555555555',
    petId: '88888888-8888-4888-8888-888888888888',
    pincode: '517501',
    paymentMethod: 'PAY_AT_PROVIDER',
    slotStartsAt: '2026-08-20T10:00:00Z',
    slotEndsAt: '2026-08-20T10:30:00Z',
  });
  expect(mockedFetch.mock.calls[3][0]).toContain(
    '/api/v1/customer/appointments/66666666-6666-4666-8666-666666666666/confirm',
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

  it('uses authenticated pet and address APIs', async () => {
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
  });
});