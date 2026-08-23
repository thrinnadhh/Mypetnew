import * as Crypto from 'expo-crypto';
import {
  getApiBaseUrl,
  getAuthGeneration,
  getRuntimeAccessToken,
  refreshCaptainSession,
} from '../auth/session';
import { AppError } from '../domain/result';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
  idempotencyKey?: string;
  _isRetry?: boolean;
}

export async function captainApiFetch(
  endpoint: string,
  options: RequestOptions = {},
): Promise<Response> {
  const baseUrl = getApiBaseUrl();
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
  const timeoutMs = options.timeoutMs ?? 15000;

  const traceId =
    (options.headers as Record<string, string>)?.[`X-Trace-Id`] ||
    (options.headers as Record<string, string>)?.[`x-trace-id`] ||
    `trace-${Crypto.randomUUID()}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Trace-Id': traceId,
    ...(options.headers as Record<string, string>),
  };

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  if (!options.skipAuth) {
    let token = getRuntimeAccessToken();
    if (!token) {
      try {
        const refreshed = await refreshCaptainSession();
        token = refreshed.accessToken;
      } catch {
        // Allow request to proceed and handle backend response
      }
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle 401 Unauthorized with maximum one automatic token refresh retry
    if (response.status === 401 && !options.skipAuth && !options._isRetry) {
      if (getRuntimeAccessToken() === null) {
        throw AppError.fromHttp(401, {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Your session has expired. Please sign in again.',
        });
      }

      const genBeforeRefresh = getAuthGeneration();
      let refreshedToken: string | null = null;
      try {
        const refreshed = await refreshCaptainSession();
        refreshedToken = refreshed.accessToken;
      } catch {
        throw AppError.fromHttp(401, {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Your session has expired. Please sign in again.',
        });
      }

      // Check if logout occurred while refresh was pending
      if (
        getAuthGeneration() !== genBeforeRefresh ||
        getRuntimeAccessToken() !== refreshedToken ||
        getRuntimeAccessToken() === null
      ) {
        throw AppError.fromHttp(401, {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Your session has expired. Please sign in again.',
        });
      }

      const retryHeaders = {
        ...headers,
        Authorization: `Bearer ${refreshedToken}`,
      };

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);

      try {
        const retryResponse = await fetch(url, {
          ...options,
          headers: retryHeaders,
          signal: retryController.signal,
        });
        clearTimeout(retryTimeoutId);
        return retryResponse;
      } catch (retryErr: any) {
        clearTimeout(retryTimeoutId);
        if (retryErr instanceof AppError) throw retryErr;
        if (retryErr.name === 'AbortError') throw AppError.timeout();
        throw AppError.network(retryErr.message || 'Network error during request retry');
      }
    }

    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error instanceof AppError) {
      throw error;
    }

    if (error.name === 'AbortError') {
      throw AppError.timeout();
    }

    throw AppError.network(error.message || 'Unable to connect to the server. Please check your network.');
  }
}

export async function handleApiResponse<T>(response: Response): Promise<T> {
  const traceId = response.headers?.get?.('x-trace-id') || undefined;

  if (response.ok) {
    if (response.status === 204) {
      return {} as T;
    }
    return (await response.json()) as T;
  }

  let errorBody: any = null;
  try {
    errorBody = await response.json();
  } catch {
    // Body is not JSON
  }

  throw AppError.fromHttp(response.status, errorBody, traceId);
}
