import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { captainApiFetch } from '../../api/client';
import {
  clearSession,
  getAuthGeneration,
  getStoredRefreshState,
  getRuntimeAccessToken,
  getRuntimeAccountId,
  refreshCaptainSession,
  resolveApiBaseUrl,
  setRuntimeAccessTokenForTesting,
  storeSession,
} from '../../auth/session';
import { CaptainSessionEnvelope } from '../../auth/types';

// Mock expo-secure-store with an in-memory store
const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

describe('Captain Session & Auth Security Invariants', () => {
  const validCaptainSession: CaptainSessionEnvelope = {
    accountId: 'captain-acc-1',
    accessToken: 'valid-access-token',
    refreshToken: 'valid-refresh-token',
    accessTokenExpiresAt: '2026-08-23T12:00:00Z',
    refreshTokenExpiresAt: '2026-09-23T12:00:00Z',
    role: 'CAPTAIN',
  };

  beforeEach(async () => {
    mockSecureStore.clear();
    (global as any).fetch = jest.fn();
    await clearSession();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enforces production API configuration even when a web bundle is served from localhost', () => {
    expect(resolveApiBaseUrl('https://captain-api.example', 'production', 'localhost')).toBe(
      'https://captain-api.example',
    );
    expect(() => resolveApiBaseUrl(undefined, 'production', 'localhost')).toThrow(
      'EXPO_PUBLIC_API_BASE_URL is required outside development',
    );
    expect(() => resolveApiBaseUrl('http://api.example', 'production', 'localhost')).toThrow(
      'Captain API configuration must use HTTPS in production',
    );
    expect(() => resolveApiBaseUrl('https://api.example', 'prod', 'localhost')).toThrow(
      'EXPO_PUBLIC_APP_ENV must be development, staging, or production',
    );
  });

  it('1. refresh starts -> logout occurs -> refresh returns 200 -> session remains logged out', async () => {
    await storeSession(validCaptainSession);
    expect(getRuntimeAccessToken()).toBe('valid-access-token');

    let resolveFetch!: (value: any) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    // Refresh starts and captures generation
    const refreshPromise = refreshCaptainSession();

    // User logs out while refresh is in-flight
    await clearSession();
    expect(getRuntimeAccessToken()).toBeNull();

    // In-flight refresh completes with 200 OK
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        accessToken: 'stale-refreshed-token',
        refreshToken: 'stale-refresh-token',
        accessTokenExpiresAt: '2026-08-23T13:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    // Stale refresh must be rejected
    await expect(refreshPromise).rejects.toThrow();

    // Session remains completely logged out
    expect(getRuntimeAccessToken()).toBeNull();
    const storedState = await getStoredRefreshState();
    expect(storedState).toBeNull();
  });

  it('2. refresh starts -> logout -> new login -> old refresh returns -> new login remains active', async () => {
    const captain1Session: CaptainSessionEnvelope = {
      ...validCaptainSession,
      accountId: 'captain-1',
      accessToken: 'c1-token',
      refreshToken: 'c1-refresh',
    };
    await storeSession(captain1Session);
    expect(getRuntimeAccessToken()).toBe('c1-token');

    let resolveCaptain1Refresh!: (value: any) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCaptain1Refresh = resolve;
        }),
    );

    // Captain 1 starts refresh
    const captain1RefreshPromise = refreshCaptainSession();

    // Logout occurs
    await clearSession();
    expect(getRuntimeAccessToken()).toBeNull();

    // Captain 2 logs in
    const captain2Session: CaptainSessionEnvelope = {
      ...validCaptainSession,
      accountId: 'captain-2',
      accessToken: 'c2-token',
      refreshToken: 'c2-refresh',
    };
    await storeSession(captain2Session);
    expect(getRuntimeAccessToken()).toBe('c2-token');

    // Captain 1 old refresh returns 200 OK
    resolveCaptain1Refresh({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-1',
        accessToken: 'c1-stale-refreshed-token',
        refreshToken: 'c1-stale-refresh-token',
        accessTokenExpiresAt: '2026-08-23T14:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T14:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    // Old refresh is rejected
    await expect(captain1RefreshPromise).rejects.toThrow();

    // Captain 2 session remains active and untainted
    expect(getRuntimeAccessToken()).toBe('c2-token');
    const storedState = await getStoredRefreshState();
    expect(storedState?.accountId).toBe('captain-2');
    expect(storedState?.refreshToken).toBe('c2-refresh');
  });

  it('3. 20 concurrent 401 requests -> one refresh flight', async () => {
    await storeSession(validCaptainSession);

    let fetchCallCount = 0;
    let resolveDelayedFetch!: (value: any) => void;
    (global.fetch as jest.Mock).mockImplementation(() => {
      fetchCallCount++;
      return new Promise((resolve) => {
        resolveDelayedFetch = resolve;
      });
    });

    const promises = Array.from({ length: 20 }, () => refreshCaptainSession());

    // Allow microtasks for getStoredRefreshState to dispatch fetch
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Single in-flight fetch created
    expect(fetchCallCount).toBe(1);

    resolveDelayedFetch({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        accessToken: 'coalesced-token',
        refreshToken: 'coalesced-refresh',
        accessTokenExpiresAt: '2026-08-23T13:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    const results = await Promise.all(promises);
    expect(results).toHaveLength(20);
    results.forEach((res) => {
      expect(res.accessToken).toBe('coalesced-token');
    });

    expect(fetchCallCount).toBe(1);
    expect(getRuntimeAccessToken()).toBe('coalesced-token');
  });

  it('4. refresh returns CUSTOMER role -> reject and clear session', async () => {
    await storeSession(validCaptainSession);

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        accessToken: 'customer-token',
        refreshToken: 'customer-refresh',
        accessTokenExpiresAt: '2026-08-23T13:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CUSTOMER',
      }),
    });

    await expect(refreshCaptainSession()).rejects.toMatchObject({
      kind: 'AuthorizationDenied',
      code: 'AUTHORIZATION_DENIED',
    });

    expect(getRuntimeAccessToken()).toBeNull();
    const stored = await getStoredRefreshState();
    expect(stored).toBeNull();
  });

  it('5. refresh response malformed -> reject', async () => {
    // Missing accessToken
    await storeSession(validCaptainSession);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        refreshToken: 'refresh-only',
        accessTokenExpiresAt: '2026-08-23T13:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    await expect(refreshCaptainSession()).rejects.toMatchObject({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
    });

    // Invalid JSON
    await storeSession(validCaptainSession);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token');
      },
    });

    await expect(refreshCaptainSession()).rejects.toMatchObject({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
    });

    // Invalid ISO date timestamp
    await storeSession(validCaptainSession);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        accessToken: 'token',
        refreshToken: 'refresh',
        accessTokenExpiresAt: 'invalid-date',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    await expect(refreshCaptainSession()).rejects.toMatchObject({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
    });
  });

  it('6. refresh 401 -> session cleared', async () => {
    await storeSession(validCaptainSession);
    expect(getRuntimeAccessToken()).toBe('valid-access-token');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: 'TOKEN_EXPIRED', message: 'Refresh token expired' }),
    });

    await expect(refreshCaptainSession()).rejects.toMatchObject({
      kind: 'AuthenticationExpired',
      code: 'AUTHENTICATION_REQUIRED',
    });

    expect(getRuntimeAccessToken()).toBeNull();
    expect(await getStoredRefreshState()).toBeNull();
  });

  it('rejects and clears a refresh response issued for a different account', async () => {
    await storeSession(validCaptainSession);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...validCaptainSession,
        accountId: 'captain-attacker',
        accessToken: 'wrong-account-token',
      }),
    });

    await expect(refreshCaptainSession()).rejects.toMatchObject({
      kind: 'AuthenticationExpired',
      code: 'SESSION_ACCOUNT_MISMATCH',
    });
    expect(getRuntimeAccessToken()).toBeNull();
    expect(getRuntimeAccountId()).toBeNull();
    expect(await getStoredRefreshState()).toBeNull();
  });

  it('7. logout while API retry pending -> no stale bearer token used afterwards', async () => {
    await storeSession(validCaptainSession);

    let initialCallDone = false;
    let resolveRefreshFetch!: (value: any) => void;
    const dispatchedRequests: { url: string; headers: any }[] = [];

    (global.fetch as jest.Mock).mockImplementation((url: string, opts: any) => {
      dispatchedRequests.push({ url, headers: opts?.headers });
      if (!initialCallDone) {
        initialCallDone = true;
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers(),
          json: async () => ({ code: 'EXPIRED_ACCESS_TOKEN' }),
        });
      }

      if (url.includes('/api/v1/auth/sessions/refresh')) {
        return new Promise((resolve) => {
          resolveRefreshFetch = resolve;
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
      });
    });

    const apiFetchPromise = captainApiFetch('/api/v1/captain/profile');

    // Give fetch microtask time to initiate
    await new Promise((r) => setTimeout(r, 10));

    // Logout during pending refresh
    await clearSession();

    resolveRefreshFetch({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        accessToken: 'refreshed-after-logout',
        refreshToken: 'refreshed-refresh-token',
        accessTokenExpiresAt: '2026-08-23T13:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    await expect(apiFetchPromise).rejects.toMatchObject({
      kind: 'AuthenticationExpired',
      code: 'AUTHENTICATION_REQUIRED',
    });

    // Verify retry to /api/v1/captain/profile was aborted and not sent
    const profileRequests = dispatchedRequests.filter((r) => r.url.includes('/api/v1/captain/profile'));
    expect(profileRequests).toHaveLength(1);
  });

  it('8. native secure-store failure -> fail closed', async () => {
    const setItemSpy = (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('Hardware Keystore unavailable'),
    );

    await expect(storeSession(validCaptainSession)).rejects.toMatchObject({
      kind: 'ServerFailure',
      code: 'SECURE_STORAGE_ERROR',
    });

    expect(getRuntimeAccessToken()).toBeNull();
    setItemSpy.mockReset();

    const getItemSpy = (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('Keystore read corruption'),
    );

    const stored = await getStoredRefreshState();
    expect(stored).toBeNull();
    getItemSpy.mockReset();
  });

  it('9. no refresh token stored in localStorage', async () => {
    const originalPlatform = Platform.OS;
    (Platform as any).OS = 'web';

    const mockLocalStorage = {
      getItem: jest.fn().mockReturnValue(null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    (global as any).localStorage = mockLocalStorage;

    await storeSession(validCaptainSession);

    // Invariant A9: localStorage MUST NOT contain refresh token
    expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
      expect.stringContaining('mypetnew.captain.refresh'),
      expect.anything(),
    );
    expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('valid-refresh-token'),
    );

    (Platform as any).OS = originalPlatform;
    delete (global as any).localStorage;
  });

  it('enforces runtime role validation on storeSession and rejects non-CAPTAIN roles', async () => {
    const merchantSession = {
      ...validCaptainSession,
      role: 'MERCHANT',
    };
    await expect(storeSession(merchantSession)).rejects.toMatchObject({
      kind: 'AuthorizationDenied',
    });

    const adminSession = {
      ...validCaptainSession,
      role: 'ADMIN',
    };
    await expect(storeSession(adminSession)).rejects.toMatchObject({
      kind: 'AuthorizationDenied',
    });
  });

  it('preserves trace ID and idempotency key across captainApiFetch', async () => {
    let capturedHeaders: Record<string, string> = {};
    (global.fetch as jest.Mock).mockImplementationOnce((url: string, opts: any) => {
      capturedHeaders = opts.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'x-trace-id': 'custom-trace-123' }),
        json: async () => ({ ok: true }),
      });
    });

    await storeSession(validCaptainSession);
    await captainApiFetch('/api/v1/captain/status', {
      headers: { 'X-Trace-Id': 'custom-trace-123' },
      idempotencyKey: 'idemp-key-456',
    });

    expect(capturedHeaders['X-Trace-Id']).toBe('custom-trace-123');
    expect(capturedHeaders['Idempotency-Key']).toBe('idemp-key-456');
    expect(capturedHeaders.Authorization).toBe('Bearer valid-access-token');
  });

  it('protects setRuntimeAccessTokenForTesting outside test environment', () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';

    expect(() => setRuntimeAccessTokenForTesting('token')).toThrow(
      'setRuntimeAccessTokenForTesting cannot be called outside test environment',
    );

    (process.env as any).NODE_ENV = originalEnv;
  });
});
