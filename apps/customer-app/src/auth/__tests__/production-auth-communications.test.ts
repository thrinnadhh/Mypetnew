jest.mock('@/utils/app-config', () => ({
  appConfig: { apiBaseUrl: 'https://api.mypet.test' },
}));

import { syncCommunicationContact } from '@/services/communication-contact';

const actualProfile = jest.requireActual('@/services/customer-profile') as typeof import('@/services/customer-profile');

function response(body: unknown = {}, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const savedAddress = {
  addressId: 'address/1',
  label: 'Home',
  recipientName: 'Customer',
  phoneNumber: '+919876543210',
  line1: 'Main Road',
  line2: null,
  city: 'Tirupati',
  state: 'Andhra Pradesh',
  pincode: '517501',
  isDefault: true,
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
};

describe('communication contact sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('sends only the bearer token to the trusted contact sync endpoint', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch.mockResolvedValue(response({}, 204));

    await expect(syncCommunicationContact('jwt-token')).resolves.toBeUndefined();
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://api.mypet.test/api/v1/notifications/contact/me',
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: 'Bearer jwt-token' },
      },
    );
  });

  it('surfaces bounded provider errors', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch.mockResolvedValue(response('provider unavailable', 503));
    await expect(syncCommunicationContact('jwt-token')).rejects.toThrow(
      'Communication contact sync failed (503): provider unavailable',
    );
  });
});

describe('delivery contact compatibility contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('normalizes Indian phones and rejects invalid delivery numbers', () => {
    expect(actualProfile.normalizeDeliveryPhone('98765 43210')).toBe('+919876543210');
    expect(actualProfile.normalizeDeliveryPhone('+91 98765 43210')).toBe('+919876543210');
    expect(() => actualProfile.normalizeDeliveryPhone('1234567890')).toThrow('valid 10-digit Indian mobile');
  });

  it('loads and saves delivery contact through the canonical Customer address resource', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([savedAddress]))
      .mockResolvedValueOnce(response([savedAddress]))
      .mockResolvedValueOnce(response({ ...savedAddress, phoneNumber: '+919876543210' }));

    await expect(actualProfile.fetchDeliveryContact('token', 'address/1')).resolves.toBeNull();
    await expect(actualProfile.fetchDeliveryContact('token', 'address/1')).resolves.toMatchObject({
      phoneNumber: '+919876543210',
    });
    await expect(actualProfile.saveDeliveryContact('token', 'address/1', '9876543210')).resolves.toMatchObject({
      phoneNumber: '+919876543210',
    });

    expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/customer/addresses');
    expect(mockedFetch.mock.calls[0][0]).not.toContain('/contact');
    expect(mockedFetch.mock.calls[3][0]).toContain('/api/v1/customer/addresses/address%2F1');
    expect(mockedFetch.mock.calls[3][1]?.method).toBe('PATCH');
    expect(JSON.parse(mockedFetch.mock.calls[3][1]?.body as string)).toMatchObject({
      phoneNumber: '+919876543210',
      line1: 'Main Road',
      pincode: '517501',
      isDefault: true,
    });
  });

  it('propagates canonical address API errors', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch.mockResolvedValueOnce(response({ message: 'Contact forbidden' }, 403));
    await expect(actualProfile.fetchDeliveryContact('token', 'address-1')).rejects.toThrow('Contact forbidden');
  });
});
