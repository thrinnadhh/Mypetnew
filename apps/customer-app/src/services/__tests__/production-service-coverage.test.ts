import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  claimWelcomeStar,
  fetchActivePromotions,
  fetchCustomerWallet,
  fetchLoyaltyLedger,
  fetchLoyaltyProgress,
} from '../loyalty';
import {
  cancelOrder,
  createCustomerOrder,
  fetchCheckoutQuote,
  fetchCustomerOrders,
  fetchOrderDetails,
  reorderItems,
} from '../customer-orders';
import {
  fetchCustomerAppointments,
  submitAppointmentReview,
} from '../customer-history';
import {
  createDefaultAddress,
  fetchDefaultAddress,
  isOfflineError,
} from '../customer-profile';
import {
  confirmAppointmentHold,
  fetchAvailableAppointmentSlots,
  holdAppointmentSlot,
} from '../appointment-booking';
import {
  fetchConversation,
  markConversationRead,
  uploadChatImage,
} from '../chat';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

const mockedFetch = jest.fn();

function response(
  body: unknown = {},
  status = 200,
  statusText = '',
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: jest.fn().mockReturnValue(null) },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const token = 'access-token';

beforeEach(async () => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  global.fetch = mockedFetch as unknown as typeof fetch;
  await AsyncStorage.clear();
});

describe('loyalty production paths', () => {
  it('loads progress, claims welcome star, wallet and both ledger URL variants', async () => {
    const progress = {
      providerId: 'provider-1', starBalance: 2, targetStars: 10, cycleCount: 0,
      totalStarsEarned: 2, welcomeStarClaimed: true, rewardAmount: 100,
      isProgramActive: true, minOrderValue: 250,
    };
    const reward = {
      rewardId: 'reward-1', providerId: 'provider-1', rewardAmount: 100,
      code: 'STAR100', status: 'ISSUED', expiresAt: '2026-09-01T00:00:00Z',
    };
    const ledger = [{
      entryId: 'entry-1', customerId: 'customer-1', providerId: 'provider-1',
      deltaStars: 1, entryType: 'PURCHASE_STAR', createdAt: '2026-08-06T00:00:00Z',
    }];
    mockedFetch
      .mockResolvedValueOnce(response(progress))
      .mockResolvedValueOnce(response(progress))
      .mockResolvedValueOnce(response([reward]))
      .mockResolvedValueOnce(response(ledger))
      .mockResolvedValueOnce(response(ledger));

    await expect(fetchLoyaltyProgress('provider/1', token)).resolves.toEqual(progress);
    await expect(claimWelcomeStar('provider/1', token)).resolves.toEqual(progress);
    await expect(fetchCustomerWallet(token)).resolves.toEqual([reward]);
    await expect(fetchLoyaltyLedger(token, 'provider/1')).resolves.toEqual(ledger);
    await expect(fetchLoyaltyLedger(token)).resolves.toEqual(ledger);

    expect(mockedFetch.mock.calls[0][0]).toContain('providerId=provider%2F1');
    expect(mockedFetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(mockedFetch.mock.calls[3][0]).toContain('providerId=provider%2F1');
    expect(mockedFetch.mock.calls[4][0]).toBe('https://api.mypet.test/api/v1/loyalty/ledger');
  });

  it('keeps only active, valid, current promotions and sorts by expiry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-06T12:00:00Z'));
    mockedFetch.mockResolvedValueOnce(response([
      {
        promotionId: 'later', code: 'LATER', discountType: 'FLAT', discountValue: 50,
        validFrom: '2026-08-01T00:00:00Z', validUntil: '2026-08-20T00:00:00Z', isActive: true,
      },
      {
        promotionId: 'sooner', code: 'SOON', discountType: 'PERCENTAGE', discountValue: '10',
        validFrom: '2026-08-01T00:00:00Z', validUntil: '2026-08-10T00:00:00Z', isActive: true,
      },
      {
        promotionId: 'inactive', code: 'OFF', discountType: 'FLAT', discountValue: 10,
        validFrom: '2026-08-01T00:00:00Z', validUntil: '2026-08-10T00:00:00Z', isActive: false,
      },
      {
        promotionId: 'future', code: 'FUTURE', discountType: 'FLAT', discountValue: 10,
        validFrom: '2026-08-07T00:00:00Z', validUntil: '2026-08-10T00:00:00Z', isActive: true,
      },
      {
        promotionId: 'expired', code: 'OLD', discountType: 'FLAT', discountValue: 10,
        validFrom: '2026-07-01T00:00:00Z', validUntil: '2026-08-01T00:00:00Z', isActive: true,
      },
      {
        promotionId: 'invalid', code: 'BAD', discountType: 'FLAT', discountValue: 10,
        validFrom: 'not-a-date', validUntil: 'also-bad', isActive: true,
      },
    ]));

    const promotions = await fetchActivePromotions(token);
    expect(promotions.map((item) => item.promotionId)).toEqual(['sooner', 'later']);
    jest.restoreAllMocks();
  });

  it('uses API message, API error and fallback errors', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ message: 'Progress blocked' }, 403))
      .mockResolvedValueOnce(response({ error: 'Already claimed' }, 409))
      .mockResolvedValueOnce({
        ...response({}, 500),
        json: jest.fn().mockRejectedValue(new Error('invalid json')),
      });

    await expect(fetchLoyaltyProgress('provider-1', token)).rejects.toThrow('Progress blocked');
    await expect(claimWelcomeStar('provider-1', token)).rejects.toThrow('Already claimed');
    await expect(fetchCustomerWallet(token)).rejects.toThrow('Could not fetch loyalty wallet');
  });
});

describe('customer address production paths', () => {
  const address = {
    addressId: 'address-1', label: 'Home', line1: 'Main Road', line2: null,
    city: 'Tirupati', state: 'Andhra Pradesh', pincode: '517501',
    geoLat: '13.6288', geoLng: '79.4192', isDefault: true,
  };

  it('returns null for missing default and normalizes numeric coordinates', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(address))
      .mockResolvedValueOnce(response(address));

    await expect(fetchDefaultAddress(token)).resolves.toBeNull();
    await expect(fetchDefaultAddress(token)).resolves.toMatchObject({ geoLat: 13.6288, geoLng: 79.4192 });
    await expect(createDefaultAddress(token, {
      label: 'Home', line1: 'Main Road', city: 'Tirupati', state: 'Andhra Pradesh',
      pincode: '517501', geoLat: 13.6288, geoLng: 79.4192,
    })).resolves.toMatchObject({ addressId: 'address-1', isDefault: true });

    expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string)).toMatchObject({ isDefault: true });
  });

  it('surfaces structured and status fallback errors', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ message: 'Address forbidden' }, 403))
      .mockResolvedValueOnce({
        ...response({}, 500),
        json: jest.fn().mockRejectedValue(new Error('bad json')),
      });

    await expect(fetchDefaultAddress(token)).rejects.toThrow('Address forbidden');
    await expect(createDefaultAddress(token, {
      line1: 'Road', city: 'Tirupati', state: 'AP', pincode: '517501', geoLat: 1, geoLng: 2,
    })).rejects.toThrow('ADDRESS_500');
  });

  it('recognizes network, fetch, offline and failed-connect errors only', () => {
    expect(isOfflineError(new TypeError('Network request failed'))).toBe(true);
    expect(isOfflineError(new Error('fetch failed'))).toBe(true);
    expect(isOfflineError(new Error('Device offline'))).toBe(true);
    expect(isOfflineError(new Error('Failed to connect'))).toBe(true);
    expect(isOfflineError(new Error('HTTP 500'))).toBe(false);
    expect(isOfflineError('network')).toBe(false);
  });
});

describe('order production paths', () => {
  it('enriches tracking records, stores cache and uses provider fallback names', async () => {
    mockedFetch
      .mockResolvedValueOnce(response([
        {
          orderId: 'order-1', providerId: 'provider-1', status: 'DELIVERED',
          flowStep: 'delivered', totalAmount: '499.50', placedAt: '2026-08-01T00:00:00Z',
          items: ['Dog Food'], paymentMethod: 'COD', paymentStatus: 'PAID',
        },
        {
          orderId: 'order-2', providerId: 'provider-2', status: 'CREATED',
          totalAmount: 'invalid', placedAt: '2026-08-02T00:00:00Z', items: null,
        },
      ]))
      .mockResolvedValueOnce(response({ name: 'Happy Pets' }))
      .mockResolvedValueOnce(response({}, 404));

    const orders = await fetchCustomerOrders('customer/1', token);
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ providerName: 'Happy Pets', rawTotal: 499.5, total: '₹500' });
    expect(orders[1]).toMatchObject({ providerName: 'Store provider', rawTotal: 0, flowStep: 'placed' });
    expect(await AsyncStorage.getItem('@mypet_orders_cache_v2_customer/1')).not.toBeNull();
    expect(mockedFetch.mock.calls[0][0]).toContain('customer%2F1');
  });

  it('returns valid cache for offline failures and removes malformed cache', async () => {
    const cached = [{ id: 'cached-order' }];
    await AsyncStorage.setItem('@mypet_orders_cache_v2_customer-1', JSON.stringify(cached));
    mockedFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(fetchCustomerOrders('customer-1', token)).resolves.toEqual(cached);

    await AsyncStorage.setItem('@mypet_orders_cache_v2_customer-2', '{broken');
    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchCustomerOrders('customer-2', token)).rejects.toThrow('offline');
    expect(await AsyncStorage.getItem('@mypet_orders_cache_v2_customer-2')).toBeNull();
  });

  it('does not hide server errors behind the offline cache', async () => {
    await AsyncStorage.setItem('@mypet_orders_cache_v2_customer-1', JSON.stringify([{ id: 'old' }]));
    mockedFetch.mockResolvedValueOnce(response({ error: 'Order service unavailable' }, 503));
    await expect(fetchCustomerOrders('customer-1', token)).rejects.toThrow('Order service unavailable');
  });

  it('maps order details and rejects missing order IDs', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({
        id: 'order-1', providerId: 'provider-1', totalAmount: 250, status: 'ACCEPTED',
        createdAt: '2026-08-01T00:00:00Z', items: [
          { offeringNameSnapshot: 'Food' }, { name: 'Toy' }, {},
        ], deliveryAddressId: 'address-1', captainId: 'captain-1',
      }))
      .mockResolvedValueOnce(response({ name: 'Store One' }))
      .mockResolvedValueOnce(response({ providerId: 'provider-1', totalAmount: 1, status: 'CREATED' }));

    await expect(fetchOrderDetails('order/1', token)).resolves.toMatchObject({
      id: 'order-1', providerName: 'Store One', items: ['Food', 'Toy', 'Pet Item'],
      deliveryAddressId: 'address-1', captainId: 'captain-1',
    });
    await expect(fetchOrderDetails('broken', token)).rejects.toThrow('invalid order ID');
  });

  it('executes cancellation, reorder, quote and order creation contracts', async () => {
    const reorder = {
      originalOrderId: 'order-1', providerId: 'provider-1', isProviderServiceable: true,
      items: [], canReorder: true,
    };
    const quote = {
      quoteToken: 'quote-1', subtotal: 500, itemDiscount: 0, couponDiscount: 0,
      loyaltyDiscount: 0, deliveryFee: 20, tax: 0, roundOff: 0, payableTotal: 520,
      isCodAvailable: true, expiresAt: '2026-08-06T12:15:00Z',
    };
    mockedFetch
      .mockResolvedValueOnce(response({}, 204))
      .mockResolvedValueOnce(response(reorder))
      .mockResolvedValueOnce(response(quote))
      .mockResolvedValueOnce(response({
        orderId: 'new-order', providerId: 'provider-1', totalAmount: '520',
        status: 'CREATED', placedAt: '2026-08-06T12:00:00Z', items: [{ name: 'Food' }],
      }, 201))
      .mockResolvedValueOnce(response({ name: 'Happy Pets' }));

    await cancelOrder('order/1', 'Changed mind & reordered', token);
    await expect(reorderItems('order/1', token)).resolves.toEqual(reorder);
    await expect(fetchCheckoutQuote({
      customerId: 'customer-1', providerId: 'provider-1', deliveryAddressId: 'address-1',
      items: [{ offeringId: 'food-1', quantity: 2 }], paymentMethod: 'COD',
    }, token)).resolves.toEqual(quote);
    await expect(createCustomerOrder({
      customerId: 'customer-1', providerId: 'provider-1', deliveryAddressId: 'address-1',
      items: [{ offeringId: 'food-1', quantity: 2 }], paymentMethod: 'COD', quoteToken: 'quote-1',
    }, token)).resolves.toMatchObject({ id: 'new-order', providerName: 'Happy Pets', rawTotal: 520 });

    expect(mockedFetch.mock.calls[0][0]).toContain('reason=Changed%20mind%20%26%20reordered');
    expect(mockedFetch.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });

  it('rejects operation errors and malformed order creation responses', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ message: 'Cannot cancel' }, 409))
      .mockResolvedValueOnce(response({ error: 'Reorder blocked' }, 422))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({ totalAmount: 20, status: 'CREATED' }, 201));

    await expect(cancelOrder('order-1', 'reason', token)).rejects.toThrow('Cannot cancel');
    await expect(reorderItems('order-1', token)).rejects.toThrow('Reorder blocked');
    await expect(fetchCheckoutQuote({
      customerId: 'c', providerId: 'p', deliveryAddressId: 'a', items: [],
    }, token)).rejects.toThrow('Could not calculate checkout quote');
    await expect(createCustomerOrder({
      customerId: 'c', providerId: 'p', deliveryAddressId: 'a', items: [],
    }, token)).rejects.toThrow('invalid response');
  });
});

describe('appointment history production paths', () => {
  it('enriches, sorts, marks reviewed appointments and caches results', async () => {
    mockedFetch
      .mockResolvedValueOnce(response([
        {
          appointmentId: 'appointment-1', customerId: 'customer-1', providerId: 'provider-1',
          offeringId: 'offering-1', slotId: 'slot-1', petId: 'pet-1', status: 'COMPLETED',
          bookedAt: '2026-08-01T09:00:00Z', priceAmount: '650',
        },
        {
          id: 'appointment-2', customerId: 'customer-1', providerId: 'provider-2',
          offeringId: 'offering-2', slotId: 'slot-2', petId: 'pet-2', status: 'CONFIRMED',
          bookedAt: '2026-08-03T09:00:00Z', priceAmount: 'invalid',
        },
      ]))
      .mockResolvedValueOnce(response([
        { id: 'review-1', targetType: 'APPOINTMENT', targetId: 'appointment-1' },
        { id: 'review-2', targetType: 'PROVIDER', targetId: 'provider-1' },
      ]))
      .mockResolvedValueOnce(response({ providerId: 'provider-1', name: 'Clinic One', address: 'Road', phone: '1' }))
      .mockResolvedValueOnce(response([{ offeringId: 'offering-1', name: 'Consultation' }]))
      .mockResolvedValueOnce(response({ slotStart: '2026-08-10T10:00:00Z' }))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({ startTime: '2026-08-11T10:00:00Z' }));

    const appointments = await fetchCustomerAppointments('customer-1', token);
    expect(appointments.map((item) => item.id)).toEqual(['appointment-2', 'appointment-1']);
    expect(appointments[1]).toMatchObject({
      providerName: 'Clinic One', serviceName: 'Consultation', hasReview: true, priceAmount: 650,
    });
    expect(appointments[0]).toMatchObject({
      providerName: 'Provider provider', serviceName: 'Service offering', hasReview: false,
    });
    expect(await AsyncStorage.getItem('@mypet_appointments_cache_v1_customer-1')).not.toBeNull();
  });

  it('uses cached history when online enrichment fails and rejects without cache', async () => {
    const cached = [{ id: 'cached-appointment' }];
    await AsyncStorage.setItem('@mypet_appointments_cache_v1_customer-1', JSON.stringify(cached));
    mockedFetch.mockRejectedValueOnce(new TypeError('offline'));
    mockedFetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(fetchCustomerAppointments('customer-1', token)).resolves.toEqual(cached);

    mockedFetch.mockResolvedValueOnce(response({ error: 'History denied' }, 403));
    mockedFetch.mockResolvedValueOnce(response([]));
    await expect(fetchCustomerAppointments('customer-2', token)).rejects.toThrow('History denied');
  });

  it('rejects appointment rows without an ID and creates trimmed or null reviews', async () => {
    mockedFetch
      .mockResolvedValueOnce(response([{
        customerId: 'customer-1', providerId: 'provider-1', offeringId: 'offering-1',
        slotId: 'slot-1', petId: 'pet-1', status: 'CONFIRMED',
      }]))
      .mockResolvedValueOnce(response([]));
    await expect(fetchCustomerAppointments('customer-3', token)).rejects.toThrow('did not include an appointment ID');

    mockedFetch
      .mockResolvedValueOnce(response({}, 201))
      .mockResolvedValueOnce(response({}, 201));
    await expect(submitAppointmentReview({
      customerId: 'customer-1', providerId: 'provider-1', targetId: 'appointment-1',
      rating: 5, comment: ' Excellent ', accessToken: token,
    })).resolves.toBe('created');
    await expect(submitAppointmentReview({
      customerId: 'customer-1', providerId: 'provider-1', targetId: 'appointment-2',
      rating: 4, comment: '   ', accessToken: token,
    })).resolves.toBe('created');
    expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string).comment).toBe('Excellent');
    expect(JSON.parse(mockedFetch.mock.calls[3][1]?.body as string).comment).toBeNull();
  });
});

describe('appointment booking production paths', () => {
  const slot = {
    id: 'slot-1', providerId: 'provider-1', offeringId: 'offering-1',
    serviceName: 'Consultation', startTime: 'start', endTime: 'end', price: 650,
  };

  it('filters services and slots, handles missing times and normalizes prices', async () => {
    mockedFetch
      .mockResolvedValueOnce(response([
        {
          offeringId: 'offering-1', providerId: 'provider-1', name: 'Consultation',
          price: '650.50', status: 'ACTIVE', durationMinutes: 30,
        },
        {
          offeringId: 'offering-2', providerId: 'provider-1', name: 'Follow-up',
          price: 'bad', stockQuantity: null,
        },
        {
          offeringId: 'inactive', providerId: 'provider-1', name: 'Inactive',
          price: 10, status: 'INACTIVE', durationMinutes: 15,
        },
        {
          offeringId: 'product', providerId: 'provider-1', name: 'Product',
          price: 10, stockQuantity: 5,
        },
      ]))
      .mockResolvedValueOnce(response([
        { slotId: 'slot-1', offeringId: 'offering-1', slotStart: '2026-08-10T10:00:00Z', slotEnd: '2026-08-10T10:30:00Z', status: 'AVAILABLE' },
        { slotId: 'busy', offeringId: 'offering-1', status: 'BOOKED' },
      ]))
      .mockResolvedValueOnce(response([
        { slotId: 'slot-2', offeringId: 'offering-2', status: 'AVAILABLE' },
      ]));

    const slots = await fetchAvailableAppointmentSlots('provider/1');
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ id: 'slot-1', price: 650.5 });
    expect(slots[1]).toMatchObject({ id: 'slot-2', price: 0, startTime: 'Slot time unavailable' });
    expect(mockedFetch.mock.calls[0][0]).toContain('providerId=provider%2F1');
  });

  it('handles booking validation, API failures, missing IDs and success', async () => {
    await expect(holdAppointmentSlot({ slot, userId: null, petId: 'pet-1', accessToken: token }))
      .rejects.toThrow('sign in');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: '', accessToken: token }))
      .rejects.toThrow('Select a pet');

    mockedFetch
      .mockResolvedValueOnce(response({ error: 'Slot occupied' }, 409))
      .mockResolvedValueOnce(response({}, 201))
      .mockResolvedValueOnce(response({ appointmentId: 'appointment-1' }, 201))
      .mockResolvedValueOnce(response({}, 204))
      .mockResolvedValueOnce(response({ message: 'Expired hold' }, 409));

    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', accessToken: token }))
      .rejects.toThrow('Slot occupied');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', accessToken: token }))
      .rejects.toThrow('no appointment ID');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', accessToken: token }))
      .resolves.toBe('appointment-1');
    await expect(confirmAppointmentHold('appointment/1', token)).resolves.toBeUndefined();
    await expect(confirmAppointmentHold('appointment/1', token)).rejects.toThrow('Expired hold');
    expect(mockedFetch.mock.calls[3][0]).toContain('appointment%2F1/confirm');
  });

  it('returns empty slots when a slot endpoint fails and surfaces offering errors', async () => {
    mockedFetch
      .mockResolvedValueOnce(response([{
        offeringId: 'offering-1', providerId: 'provider-1', name: 'Consultation',
        price: 500, durationMinutes: 30,
      }]))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({ message: 'Catalog offline' }, 503));

    await expect(fetchAvailableAppointmentSlots('provider-1')).resolves.toEqual([]);
    await expect(fetchAvailableAppointmentSlots('provider-1')).rejects.toThrow('Catalog offline');
  });
});

describe('chat attachment and read paths', () => {
  it('fetches a conversation and uploads an authenticated multipart image', async () => {
    const conversation = { conversationId: 'conversation-1' };
    const uploaded = { imageUrl: 'https://files/image.jpg', imageMimeType: 'image/jpeg' };
    mockedFetch
      .mockResolvedValueOnce(response(conversation))
      .mockResolvedValueOnce(response(uploaded, 201));

    await expect(fetchConversation('conversation-1', token)).resolves.toEqual(conversation);
    await expect(uploadChatImage('file:///image.jpg', 'image/jpeg', 'image.jpg', token)).resolves.toEqual(uploaded);
    expect(mockedFetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(mockedFetch.mock.calls[1][1]?.headers).toEqual({
      Accept: 'application/json', Authorization: `Bearer ${token}`,
    });
    expect(mockedFetch.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
  });

  it('uses server and fallback errors when marking messages read', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ error: 'Conversation denied' }, 403))
      .mockResolvedValueOnce({
        ...response({}, 500),
        json: jest.fn().mockRejectedValue(new Error('bad json')),
      });

    await expect(markConversationRead('conversation-1', token)).rejects.toThrow('Conversation denied');
    await expect(markConversationRead('conversation-1', token)).rejects.toThrow('Could not mark messages as read');
  });
});
