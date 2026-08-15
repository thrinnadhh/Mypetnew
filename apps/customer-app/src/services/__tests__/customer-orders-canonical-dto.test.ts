import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchCustomerOrders, fetchOrderDetails } from '../customer-orders';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

const mockedFetch = jest.fn();

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn().mockReturnValue(null) },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  global.fetch = mockedFetch as unknown as typeof fetch;
  await AsyncStorage.clear();
});

test('canonical tracking consumes server provider payment captain eta and delivery truth without enrichment calls', async () => {
  mockedFetch.mockResolvedValueOnce(response([
    {
      orderId: 'order-1',
      providerId: 'provider-1',
      providerName: 'Happy Pets Tirupati',
      status: 'PICKED_UP',
      flowStep: 'picked_up',
      totalAmount: '599.50',
      placedAt: '2026-08-11T08:00:00Z',
      items: ['Dog Food', 'Treats'],
      paymentMethod: 'COD',
      paymentStatus: 'COD_PENDING',
      captain: { captainId: 'captain-1', assignedAt: '2026-08-11T08:20:00Z' },
      etaMinutes: 12,
      deliveryStatus: 'PICKED_UP',
      statusHistory: [
        { fromStatus: 'ASSIGNED', toStatus: 'PICKED_UP', changedAt: '2026-08-11T08:30:00Z', note: null },
      ],
    },
  ]));

  const orders = await fetchCustomerOrders('customer-1', 'access-token');

  expect(orders).toEqual([
    expect.objectContaining({
      id: 'order-1',
      providerName: 'Happy Pets Tirupati',
      status: 'PICKED_UP',
      flowStep: 'picked_up',
      paymentMethod: 'COD',
      paymentStatus: 'COD_PENDING',
      captainId: 'captain-1',
      captainAssignedAt: '2026-08-11T08:20:00Z',
      etaMinutes: 12,
      deliveryStatus: 'PICKED_UP',
      rawTotal: 599.5,
    }),
  ]);
  expect(mockedFetch).toHaveBeenCalledTimes(1);
});

test('canonical customer order detail maps every server-owned section into the mobile order record', async () => {
  mockedFetch.mockResolvedValueOnce(response({
    orderId: 'order-2',
    provider: {
      providerId: 'provider-2',
      name: 'MyPet Store',
      providerType: 'PET_STORE',
    },
    items: [
      {
        orderItemId: 'item-1',
        offeringId: 'offering-1',
        name: 'Premium Food',
        unitPrice: '500',
        quantity: 1,
        lineTotal: '500',
      },
    ],
    pricing: {
      subtotal: '500',
      discount: '50',
      loyaltyDiscount: '0',
      delivery: '25',
      tax: '22.50',
      total: '497.50',
    },
    payment: {
      method: 'ONLINE',
      status: 'SUCCESS',
      paymentId: 'payment-1',
    },
    status: 'READY_FOR_PICKUP',
    flowStep: 'ready_for_pickup',
    statusHistory: [
      { fromStatus: 'PREPARING', toStatus: 'READY_FOR_PICKUP', changedAt: '2026-08-11T09:00:00Z', note: 'Packed' },
    ],
    deliveryAddress: {
      addressId: 'address-1',
      label: 'Home',
      line1: 'Main Road',
      line2: null,
      city: 'Tirupati',
      state: 'Andhra Pradesh',
      pincode: '517501',
      latitude: 13.6288,
      longitude: 79.4192,
    },
    deliveryContact: {
      phone: '+919999999999',
      verified: true,
    },
    captain: {
      captainId: 'captain-2',
      assignedAt: '2026-08-11T09:05:00Z',
    },
    timestamps: {
      placedAt: '2026-08-11T08:00:00Z',
      acceptedAt: '2026-08-11T08:10:00Z',
      preparingAt: '2026-08-11T08:20:00Z',
      readyAt: '2026-08-11T09:00:00Z',
      pickedUpAt: null,
      deliveredAt: null,
      cancelledAt: null,
    },
    cancellation: {
      cancelled: false,
      reason: null,
      cancelledAt: null,
    },
    invoice: {
      invoiceId: 'invoice-1',
      invoiceNumber: 'INV-1001',
      subtotal: '500',
      tax: '22.50',
      total: '497.50',
      generatedAt: '2026-08-11T09:00:00Z',
    },
  }));

  const order = await fetchOrderDetails('order-2', 'access-token');

  expect(order).toMatchObject({
    id: 'order-2',
    providerId: 'provider-2',
    providerName: 'MyPet Store',
    providerType: 'PET_STORE',
    items: ['Premium Food'],
    total: '₹498',
    rawTotal: 497.5,
    status: 'READY_FOR_PICKUP',
    flowStep: 'ready_for_pickup',
    paymentMethod: 'ONLINE',
    paymentStatus: 'SUCCESS',
    deliveryAddressId: 'address-1',
    deliveryContactPhone: '+919999999999',
    deliveryContactVerified: true,
    captainId: 'captain-2',
    captainAssignedAt: '2026-08-11T09:05:00Z',
    invoiceNumber: 'INV-1001',
  });
  expect(order.deliveryAddress).toMatchObject({ city: 'Tirupati', pincode: '517501' });
  expect(order.statusHistory).toHaveLength(1);
  expect(mockedFetch).toHaveBeenCalledTimes(1);
});
