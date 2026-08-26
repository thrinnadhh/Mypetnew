import AsyncStorage from '@react-native-async-storage/async-storage';

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
  // Dev-only registry override: chat routes are deferred/fail-closed in the backend
  // registry, so these transport-coverage tests opt in explicitly.
  process.env.EXPO_PUBLIC_ENABLE_CHAT = 'true';
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_ENABLE_CHAT;
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

describe('appointment history production paths', () => {
  it('maps canonical snapshots, sorts appointments and preserves offline cache compatibility', async () => {
    mockedFetch.mockResolvedValueOnce(response({
      items: [
        {
          appointmentId: 'appointment-1', outletId: 'provider-1', serviceId: 'offering-1',
          slotId: 'slot-1', petId: 'pet-1', providerName: 'Clinic One',
          serviceName: 'Consultation', petName: 'Milo',
          startsAt: '2026-08-20T10:00:00Z', endsAt: '2026-08-20T10:30:00Z',
          status: 'COMPLETED', paymentMethod: 'PAY_AT_PROVIDER', paymentStatus: 'NOT_REQUIRED',
          pricePaise: 65000, currency: 'INR', holdExpiresAt: null,
          createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-20T11:00:00Z',
        },
        {
          appointmentId: 'appointment-2', outletId: 'provider-2', serviceId: 'offering-2',
          slotId: 'slot-2', petId: 'pet-2', providerName: 'Groomer Two',
          serviceName: 'Full Spa', petName: 'Luna',
          startsAt: '2026-08-21T10:00:00Z', endsAt: '2026-08-21T11:00:00Z',
          status: 'BOOKED', paymentMethod: 'PAY_AT_PROVIDER', paymentStatus: 'NOT_REQUIRED',
          pricePaise: '90000', currency: 'INR', holdExpiresAt: null,
          createdAt: '2026-08-03T09:00:00Z', updatedAt: '2026-08-03T09:00:00Z',
        },
      ],
      page: 0, pageSize: 100, hasNext: false,
    }));

    const appointments = await fetchCustomerAppointments('customer-1', token);
    expect(appointments.map((item) => item.id)).toEqual(['appointment-2', 'appointment-1']);
    expect(appointments[1]).toMatchObject({
      providerName: 'Clinic One', serviceName: 'Consultation', petName: 'Milo',
      hasReview: false, canReview: false, priceAmount: 650,
    });
    expect(appointments[0]).toMatchObject({
      providerName: 'Groomer Two', serviceName: 'Full Spa', priceAmount: 900,
      status: 'PENDING_PROVIDER',
    });
    expect(await AsyncStorage.getItem('@mypet_appointments_cache_v1_customer-1')).not.toBeNull();
    expect(mockedFetch.mock.calls[0][0]).toBe(
      'https://api.mypet.test/api/v1/customer/appointments?page=0&pageSize=20',
    );
  });

  it('uses cached history only for network failures and never hides authorization errors', async () => {
    const cached = [{ id: 'cached-appointment' }];
    await AsyncStorage.setItem('@mypet_appointments_cache_v1_customer-1', JSON.stringify(cached));
    mockedFetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(fetchCustomerAppointments('customer-1', token)).resolves.toEqual(cached);

    await AsyncStorage.setItem('@mypet_appointments_cache_v1_customer-2', JSON.stringify([{ id: 'stale' }]));
    mockedFetch.mockResolvedValueOnce(response({ error: 'History denied' }, 403));
    await expect(fetchCustomerAppointments('customer-2', token)).rejects.toThrow('History denied');
  });

  it('does not issue legacy appointment review requests', async () => {
    await expect(submitAppointmentReview({
      customerId: 'customer-1', providerId: 'provider-1', targetId: 'appointment-1',
      rating: 5, comment: 'Excellent', accessToken: token,
    })).rejects.toThrow('reviews are not available');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('appointment booking production paths', () => {
  const slot = {
    id: 'slot-1', providerId: 'provider-1', offeringId: 'offering-1',
    serviceName: 'Consultation', startTime: 'start', endTime: 'end',
    startsAt: '2026-08-20T10:00:00Z', endsAt: '2026-08-20T10:30:00Z', price: 650,
  };

  const servicesPage = {
    items: [
      {
        serviceId: 'offering-1', outletId: 'provider-1', capability: 'VETERINARY',
        name: 'Consultation', description: 'General consultation', durationMinutes: 30,
        pricePaise: 65050, currency: 'INR',
      },
      {
        serviceId: 'offering-2', outletId: 'provider-1', capability: 'VETERINARY',
        name: 'Follow-up', description: null, durationMinutes: 15,
        pricePaise: '0', currency: 'INR',
      },
    ],
    page: 0, pageSize: 100, hasNext: false,
  };

  it('loads canonical services and slots, handles missing times and normalizes paise prices', async () => {
    mockedFetch
      .mockResolvedValueOnce(response(servicesPage))
      .mockResolvedValueOnce(response({
        items: [{
          slotId: 'slot-1', serviceId: 'offering-1',
          startsAt: '2026-08-20T10:00:00Z', endsAt: '2026-08-20T10:30:00Z',
        }], page: 0, pageSize: 100, hasNext: false,
      }))
      .mockResolvedValueOnce(response({
        items: [{ slotId: 'slot-2', serviceId: 'offering-2', startsAt: '', endsAt: '' }],
        page: 0, pageSize: 100, hasNext: false,
      }));

    const slots = await fetchAvailableAppointmentSlots('provider/1');
    expect(slots).toHaveLength(2);
    expect(slots.find((item) => item.id === 'slot-1')).toMatchObject({ id: 'slot-1', price: 650.5 });
    expect(slots.find((item) => item.id === 'slot-2')).toMatchObject({ id: 'slot-2', price: 0, startTime: 'Slot time unavailable' });
    expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/public/services?');
    expect(mockedFetch.mock.calls[0][0]).toContain('outletId=provider%2F1');
    expect(mockedFetch.mock.calls[1][0]).toContain('/api/v1/public/services/offering-1/availability?');
  });

  it('enforces booking validation, idempotent secure payloads, API failures and confirmation', async () => {
    await expect(holdAppointmentSlot({ slot, userId: null, petId: 'pet-1', pincode: '517501', accessToken: token }))
      .rejects.toThrow('sign in');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: '', pincode: '517501', accessToken: token }))
      .rejects.toThrow('Select a pet');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', pincode: '517501', accessToken: null }))
      .rejects.toThrow('sign in');

    mockedFetch
      .mockResolvedValueOnce(response({ error: 'Slot occupied' }, 409))
      .mockResolvedValueOnce(response({}, 201))
      .mockResolvedValueOnce(response({ appointmentId: 'appointment-1' }, 201))
      .mockResolvedValueOnce(response({}, 204))
      .mockResolvedValueOnce(response({ message: 'Expired hold' }, 409));

    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', pincode: '517501', accessToken: token }))
      .rejects.toThrow('Slot occupied');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', pincode: '517501', accessToken: token }))
      .rejects.toThrow('no appointment ID');
    await expect(holdAppointmentSlot({ slot, userId: 'customer-1', petId: 'pet-1', pincode: '517501', accessToken: token }))
      .resolves.toBe('appointment-1');

    const holdRequest = mockedFetch.mock.calls[2][1];
    expect(holdRequest?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'Idempotency-Key': 'appointment-v2-slot-1-pet-1-517501',
    });
    expect(JSON.parse(holdRequest?.body as string)).toEqual({
      outletId: 'provider-1', serviceId: 'offering-1', slotId: 'slot-1', petId: 'pet-1',
      pincode: '517501', paymentMethod: 'PAY_AT_PROVIDER',
      slotStartsAt: '2026-08-20T10:00:00Z', slotEndsAt: '2026-08-20T10:30:00Z',
    });

    await expect(confirmAppointmentHold('appointment/1', token)).resolves.toBeUndefined();
    await expect(confirmAppointmentHold('appointment/1', token)).rejects.toThrow('Expired hold');
    expect(mockedFetch.mock.calls[3][0]).toContain('appointment%2F1/confirm');
  });

  it('surfaces availability failures and service catalogue errors after bounded safe retries', async () => {
    mockedFetch
      .mockResolvedValueOnce(response(servicesPage))
      .mockResolvedValueOnce(response({ message: 'Availability offline' }, 503))
      .mockResolvedValueOnce(response({ message: 'Availability offline' }, 503))
      .mockResolvedValueOnce(response({ message: 'Availability offline' }, 503))
      .mockResolvedValueOnce(response({ message: 'Catalog offline' }, 503))
      .mockResolvedValueOnce(response({ message: 'Catalog offline' }, 503))
      .mockResolvedValueOnce(response({ message: 'Catalog offline' }, 503));

    await expect(fetchAvailableAppointmentSlots('provider-1')).rejects.toThrow('Availability offline');
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
