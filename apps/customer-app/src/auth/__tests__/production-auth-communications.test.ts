jest.mock('expo-linking', () => ({
  createURL: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('@/utils/app-config', () => ({
  appConfig: { apiBaseUrl: 'https://api.mypet.test' },
}));

jest.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
      updateUser: jest.fn(),
      verifyOtp: jest.fn(),
      refreshSession: jest.fn(),
    },
  },
}));

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { signInWithGoogle } from '@/auth/google-auth';
import { requestPhoneLink, verifyPhoneLink } from '@/auth/phone-link';
import { syncCommunicationContact } from '@/services/communication-contact';
import { supabase } from '@/utils/supabase';

const mockCreateURL = Linking.createURL as jest.MockedFunction<typeof Linking.createURL>;
const mockOpenAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.MockedFunction<typeof WebBrowser.openAuthSessionAsync>;
const mockSignInWithOAuth = supabase.auth.signInWithOAuth as jest.MockedFunction<typeof supabase.auth.signInWithOAuth>;
const mockExchangeCodeForSession = supabase.auth.exchangeCodeForSession as jest.MockedFunction<typeof supabase.auth.exchangeCodeForSession>;
const mockSetSession = supabase.auth.setSession as jest.MockedFunction<typeof supabase.auth.setSession>;
const mockUpdateUser = supabase.auth.updateUser as jest.MockedFunction<typeof supabase.auth.updateUser>;
const mockVerifyOtp = supabase.auth.verifyOtp as jest.MockedFunction<typeof supabase.auth.verifyOtp>;
const mockRefreshSession = supabase.auth.refreshSession as jest.MockedFunction<typeof supabase.auth.refreshSession>;

const actualProfile = jest.requireActual('@/services/customer-profile') as typeof import('@/services/customer-profile');

function response(body: unknown = {}, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('production Google authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateURL.mockReturnValue('customerapp://auth/callback');
    mockSignInWithOAuth.mockResolvedValue({ data: { provider: 'google', url: 'https://accounts.google.test/oauth' }, error: null });
  });

  it('exchanges an authorization code for a Supabase session', async () => {
    const session = { access_token: 'access', refresh_token: 'refresh', user: { id: 'user-1' } } as never;
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'customerapp://auth/callback?code=google-code',
    });
    mockExchangeCodeForSession.mockResolvedValue({ data: { session, user: null }, error: null } as never);

    await expect(signInWithGoogle()).resolves.toBe(session);
    expect(mockCreateURL).toHaveBeenCalledWith('auth/callback');
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: expect.objectContaining({
        redirectTo: 'customerapp://auth/callback',
        skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      }),
    });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('google-code');
  });

  it('accepts token-fragment callbacks when PKCE code is unavailable', async () => {
    const session = { access_token: 'access', refresh_token: 'refresh', user: { id: 'user-2' } } as never;
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'customerapp://auth/callback#access_token=access&refresh_token=refresh',
    });
    mockSetSession.mockResolvedValue({ data: { session, user: null }, error: null } as never);

    await expect(signInWithGoogle()).resolves.toBe(session);
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' });
  });

  it('rejects cancellation, callback errors and incomplete callbacks', async () => {
    mockOpenAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'CANCELLED' });

    mockOpenAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'customerapp://auth/callback?error_description=access_denied',
    });
    await expect(signInWithGoogle()).rejects.toThrow('access_denied');

    mockOpenAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'customerapp://auth/callback?state=only',
    });
    await expect(signInWithGoogle()).rejects.toThrow('incomplete authentication response');
  });

  it('normalizes provider and session creation failures', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ data: { provider: 'google', url: null }, error: { status: 429, message: 'rate limit' } } as never);
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    mockSignInWithOAuth.mockResolvedValueOnce({ data: { provider: 'google', url: null }, error: null } as never);
    await expect(signInWithGoogle()).rejects.toThrow('could not be started');
  });
});

describe('same-identity phone linking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests and verifies phone_change OTP without creating a second identity', async () => {
    const session = { user: { id: 'user-1', phone: '+919876543210' } } as never;
    mockUpdateUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    mockVerifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
    mockRefreshSession.mockResolvedValue({ data: { session, user: null }, error: null } as never);

    await expect(requestPhoneLink('98765 43210')).resolves.toBe('+919876543210');
    await expect(verifyPhoneLink('+919876543210', ' 123456 ')).resolves.toBe(session);

    expect(mockUpdateUser).toHaveBeenCalledWith({ phone: '+919876543210' });
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      phone: '+919876543210', token: '123456', type: 'phone_change',
    });
  });

  it('rejects malformed codes and provider failures', async () => {
    await expect(verifyPhoneLink('+919876543210', '123')).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    mockUpdateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Failed to fetch' } } as never);
    await expect(requestPhoneLink('9876543210')).rejects.toMatchObject({ code: 'NETWORK' });

    mockVerifyOtp.mockResolvedValueOnce({ data: { session: null, user: null }, error: { message: 'token expired', status: 400 } } as never);
    await expect(verifyPhoneLink('+919876543210', '123456')).rejects.toMatchObject({ code: 'EXPIRED_CODE' });
  });

  it('requires a refreshed session after successful phone verification', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
    mockRefreshSession.mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
    await expect(verifyPhoneLink('+919876543210', '123456')).rejects.toThrow(
      'verified mobile could not be attached',
    );
  });
});

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

describe('delivery contact API contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('normalizes Indian phones and rejects invalid delivery numbers', () => {
    expect(actualProfile.normalizeDeliveryPhone('98765 43210')).toBe('+919876543210');
    expect(actualProfile.normalizeDeliveryPhone('+91 98765 43210')).toBe('+919876543210');
    expect(() => actualProfile.normalizeDeliveryPhone('1234567890')).toThrow('valid 10-digit Indian mobile');
  });

  it('loads, saves and handles missing delivery contacts', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ addressId: 'address/1', phoneNumber: '+919876543210' }))
      .mockResolvedValueOnce(response({ addressId: 'address/1', phoneNumber: '+919876543210' }));

    await expect(actualProfile.fetchDeliveryContact('token', 'address/1')).resolves.toBeNull();
    await expect(actualProfile.fetchDeliveryContact('token', 'address/1')).resolves.toMatchObject({
      phoneNumber: '+919876543210',
    });
    await expect(actualProfile.saveDeliveryContact('token', 'address/1', '9876543210')).resolves.toMatchObject({
      phoneNumber: '+919876543210',
    });

    expect(mockedFetch.mock.calls[0][0]).toContain('address%2F1/contact');
    expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string)).toEqual({
      phoneNumber: '+919876543210',
    });
  });

  it('propagates delivery contact API errors', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch.mockResolvedValueOnce(response({ message: 'Contact forbidden' }, 403));
    await expect(actualProfile.fetchDeliveryContact('token', 'address-1')).rejects.toThrow('Contact forbidden');
  });
});
