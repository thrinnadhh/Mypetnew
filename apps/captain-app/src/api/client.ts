import * as Crypto from 'expo-crypto';
import {
  clearSession,
  getApiBaseUrl,
  getRuntimeAccessToken,
  refreshCaptainSession,
} from '../auth/session';
import { AppError } from '../domain/result';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
  idempotencyKey?: string;
}

export async function captainApiFetch(
  endpoint: string,
  options: RequestOptions = {},
): Promise<Response> {
  const baseUrl = getApiBaseUrl();
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
  const timeoutMs = options.timeoutMs ?? 15000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Trace-Id': `trace-${Crypto.randomUUID()}`,
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
        // Allow request to proceed and handle backend 401
      }
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle 401 Unauthorized with one automatic token refresh retry
    if (response.status === 401 && !options.skipAuth) {
      try {
        const refreshed = await refreshCaptainSession();
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${refreshed.accessToken}`,
        };
        return await fetch(url, {
          ...options,
          headers: retryHeaders,
        });
      } catch {
        await clearSession();
        throw AppError.fromHttp(401, {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Your session has expired. Please sign in again.',
        });
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
