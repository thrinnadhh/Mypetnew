import { captainApiFetch, handleApiResponse } from '../../api/client';
import {
  clearSession,
  getStoredRefreshState,
  getRuntimeAccessToken,
  setRuntimeAccessTokenForTesting,
  storeSession,
} from '../../auth/session';
import { CaptainSessionEnvelope } from '../../auth/types';
import { AppError } from '../../domain/result';

describe('Level 2: API Client Contract Tests', () => {
  const validCaptainSession: CaptainSessionEnvelope = {
    accountId: 'captain-acc-101',
    accessToken: 'valid-access-token-jwt',
    refreshToken: 'valid-refresh-token-jwt',
    accessTokenExpiresAt: '2026-08-23T12:00:00Z',
    refreshTokenExpiresAt: '2026-09-23T12:00:00Z',
    role: 'CAPTAIN',
  };

  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await clearSession();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('HTTP Headers, Bearer Tokens & Tracing Contract', () => {
    it('automatically sends Accept, X-Trace-Id, and Authorization Bearer headers', async () => {
      await storeSession(validCaptainSession);

      let capturedHeaders: Record<string, string> = {};
      (global.fetch as jest.Mock).mockImplementationOnce((_url, opts) => {
        capturedHeaders = opts.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'x-trace-id': 'custom-trace-01' }),
          json: async () => ({ status: 'ACTIVE' }),
        });
      });

      const response = await captainApiFetch('/api/v1/captain/status', {
        headers: { 'X-Trace-Id': 'custom-trace-01' },
      });

      expect(response.ok).toBe(true);
      expect(capturedHeaders.Accept).toBe('application/json');
      expect(capturedHeaders['X-Trace-Id']).toBe('custom-trace-01');
      expect(capturedHeaders.Authorization).toBe('Bearer valid-access-token-jwt');
    });

    it('attaches Idempotency-Key header on mutation requests', async () => {
      await storeSession(validCaptainSession);

      let capturedHeaders: Record<string, string> = {};
      (global.fetch as jest.Mock).mockImplementationOnce((_url, opts) => {
        capturedHeaders = opts.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ accepted: true }),
        });
      });

      await captainApiFetch('/api/v1/captain/dispatch/offers/off-1/respond', {
        method: 'POST',
        idempotencyKey: 'idemp-key-xyz-777',
      });

      expect(capturedHeaders['Idempotency-Key']).toBe('idemp-key-xyz-777');
    });
  });

  describe('HTTP Status Code to Domain Error Classification', () => {
    it('classifies 400 Bad Request to ValidationRejected', async () => {
      const response = new Response(
        JSON.stringify({ code: 'INVALID_INPUT', message: 'Coordinate out of range' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'ValidationRejected',
        status: 400,
        message: 'Coordinate out of range',
        retryable: false,
      });
    });

    it('classifies 422 Unprocessable Entity to ValidationRejected', async () => {
      const response = new Response(
        JSON.stringify({ code: 'SCHEMA_VIOLATION', message: 'Malformed JSON payload' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'ValidationRejected',
        status: 422,
      });
    });

    it('classifies 401 Unauthorized to AuthenticationExpired', async () => {
      const response = new Response(
        JSON.stringify({ code: 'EXPIRED_TOKEN', message: 'JWT has expired' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'AuthenticationExpired',
        status: 401,
      });
    });

    it('classifies 403 Forbidden to AuthorizationDenied', async () => {
      const response = new Response(
        JSON.stringify({ code: 'CAPTAIN_SUSPENDED', message: 'Account is suspended' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'AuthorizationDenied',
        status: 403,
      });
    });

    it('classifies 404 Not Found to ResourceNotFound', async () => {
      const response = new Response(
        JSON.stringify({ code: 'JOB_NOT_FOUND', message: 'No active delivery job found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'ResourceNotFound',
        status: 404,
      });
    });

    it('classifies 408 Request Timeout to retryable Timeout', async () => {
      const response = new Response(
        JSON.stringify({ code: 'REQUEST_TIMEOUT', message: 'Server gateway timeout' }),
        { status: 408, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'Timeout',
        status: 408,
        retryable: true,
      });
    });

    it('classifies 409 Conflict to Conflict', async () => {
      const response = new Response(
        JSON.stringify({ code: 'OFFER_ALREADY_CLAIMED', message: 'Offer claimed by another captain' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(handleApiResponse(response)).rejects.toMatchObject({
        kind: 'Conflict',
        status: 409,
        retryable: false,
      });
    });

    it('classifies 500, 502, 503, 504 to retryable ServerFailure', async () => {
      for (const status of [500, 502, 503, 504]) {
        const response = new Response(
          JSON.stringify({ code: 'INTERNAL_ERROR', message: `Server error ${status}` }),
          { status, headers: { 'Content-Type': 'application/json' } },
        );

        await expect(handleApiResponse(response)).rejects.toMatchObject({
          kind: 'ServerFailure',
          status,
          retryable: true,
        });
      }
    });
  });

  describe('Network Failure & Timeout Classification in Fetch Client', () => {
    it('classifies AbortError to retryable Timeout', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);

      await expect(captainApiFetch('/api/v1/captain/status', { skipAuth: true })).rejects.toMatchObject({
        kind: 'Timeout',
        status: 408,
        retryable: true,
      });
    });

    it('classifies Network disconnection / connection reset to retryable NetworkUnavailable', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));

      await expect(captainApiFetch('/api/v1/captain/status', { skipAuth: true })).rejects.toMatchObject({
        kind: 'NetworkUnavailable',
        status: 0,
        retryable: true,
      });
    });
  });

  describe('401 Token Refresh & Coalescing Semantics', () => {
    it('executes exactly one retry when receiving 401 and refresh succeeds', async () => {
      await storeSession(validCaptainSession);

      let callCount = 0;
      (global.fetch as jest.Mock).mockImplementation((url) => {
        callCount++;
        if (url.includes('/api/v1/captain/profile')) {
          if (callCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 401,
              headers: new Headers(),
              json: async () => ({ code: 'EXPIRED_TOKEN' }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ captainId: 'captain-acc-101', name: 'Ravi' }),
          });
        }
        if (url.includes('/api/v1/auth/sessions/refresh')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              accountId: 'captain-acc-101',
              accessToken: 'new-refreshed-jwt',
              refreshToken: 'new-refresh-jwt',
              accessTokenExpiresAt: '2026-08-23T14:00:00Z',
              refreshTokenExpiresAt: '2026-09-23T14:00:00Z',
              role: 'CAPTAIN',
            }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const response = await captainApiFetch('/api/v1/captain/profile');
      expect(response.ok).toBe(true);
      expect(getRuntimeAccessToken()).toBe('new-refreshed-jwt');
    });

    it('fails closed and clears session when refresh token is also rejected (401 on refresh)', async () => {
      await storeSession(validCaptainSession);

      (global.fetch as jest.Mock).mockImplementation((url) => {
        if (url.includes('/api/v1/captain/profile')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers(),
            json: async () => ({ code: 'EXPIRED_TOKEN' }),
          });
        }
        if (url.includes('/api/v1/auth/sessions/refresh')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers(),
            json: async () => ({ code: 'REFRESH_TOKEN_EXPIRED' }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      await expect(captainApiFetch('/api/v1/captain/profile')).rejects.toMatchObject({
        kind: 'AuthenticationExpired',
      });

      expect(getRuntimeAccessToken()).toBeNull();
      expect(await getStoredRefreshState()).toBeNull();
    });
  });
});
