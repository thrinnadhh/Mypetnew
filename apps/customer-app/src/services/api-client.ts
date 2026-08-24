import { ApiError, apiErrorFromResponse, normalizeApiErrorPayload } from '../contracts/api-error';
import { appConfig } from '../utils/app-config';

export { ApiError } from '../contracts/api-error';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5_000;
const BASE_RETRY_DELAY_MS = 250;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class StaleAuthResponseError extends Error {
  constructor() {
    super('Request superseded by an account or session change');
    this.name = 'StaleAuthResponseError';
  }
}

export class RequestCancelledError extends Error {
  constructor() {
    super('Request was cancelled');
    this.name = 'RequestCancelledError';
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  correlationId?: string;
  /**
   * Transitional per-call token support for service APIs that still accept an
   * accessToken argument. Header construction remains owned by ApiClient.
   */
  authToken?: string | null;
  errorFallback?: string;
  _isRetry?: boolean;
}

export type RefreshHandler = () => Promise<string | null>;
export type ClearAuthHandler = () => void;

type RequestBody = BodyInit | undefined;

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}

function transportApiError(code: 'NETWORK_ERROR' | 'TIMEOUT', message: string, cause?: unknown): ApiError {
  const error = new ApiError(
    0,
    normalizeApiErrorPayload(0, '', { code, message, details: cause instanceof Error ? cause.message : undefined }),
    cause,
  );
  error.name = code === 'TIMEOUT' ? 'ApiTimeoutError' : 'ApiNetworkError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

class ApiClient {
  private sessionToken: string | null = null;
  private refreshHandler: RefreshHandler | null = null;
  private clearAuthHandler: ClearAuthHandler | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private authEpoch = 0;

  public setSessionToken(token: string | null) {
    this.sessionToken = token;
    if (token === null) this.advanceAuthEpoch();
  }

  public advanceAuthEpoch() {
    this.authEpoch++;
    this.refreshPromise = null;
  }

  public getSessionToken(): string | null {
    return this.sessionToken;
  }

  public getAuthEpoch(): number {
    return this.authEpoch;
  }

  public setRefreshHandler(handler: RefreshHandler | null) {
    this.refreshHandler = handler;
  }

  public setClearAuthHandler(handler: ClearAuthHandler | null) {
    this.clearAuthHandler = handler;
  }

  private getBaseUrl(): string {
    return appConfig.apiBaseUrl || 'http://localhost:8080';
  }

  private resolveUrl(path: string): { url: string; authAllowed: boolean } {
    const baseUrl = this.getBaseUrl().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(path)) {
      return { url: `${baseUrl}/${path.replace(/^\/+/, '')}`, authAllowed: true };
    }

    try {
      const requested = new URL(path);
      const backend = new URL(baseUrl);
      return { url: path, authAllowed: requested.origin === backend.origin };
    } catch {
      return { url: path, authAllowed: false };
    }
  }

  private buildHeaders(
    body: unknown,
    customHeaders?: Record<string, string>,
    authAllowed = true,
    correlationId?: string,
    authToken?: string | null,
  ): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (body !== undefined && !isFormData(body)) {
      headers['Content-Type'] = 'application/json';
    }

    if (customHeaders) {
      for (const [key, value] of Object.entries(customHeaders)) {
        if (key.toLowerCase() === 'x-idempotency-key') {
          headers['Idempotency-Key'] = value;
        } else {
          headers[key] = value;
        }
      }
    }

    if (correlationId && !headerValue(headers, 'x-request-id') && !headerValue(headers, 'x-correlation-id')) {
      headers['X-Request-ID'] = correlationId;
    }

    const effectiveToken = authToken === undefined ? this.sessionToken : authToken;
    if (authAllowed && effectiveToken && !headerValue(headers, 'authorization')) {
      headers.Authorization = `Bearer ${effectiveToken}`;
    }

    return headers;
  }

  private isAuthEndpoint(path: string): boolean {
    return (
      path.includes('/api/v1/auth/sessions/refresh') ||
      path.includes('/api/v1/auth/sessions/current') ||
      path.includes('/api/v1/auth/otp/verify') ||
      path.includes('/api/v1/auth/otp/request')
    );
  }

  private canRetry(method: string, headers: Record<string, string>): boolean {
    const normalized = method.toUpperCase();
    return normalized === 'GET' || normalized === 'HEAD' || Boolean(headerValue(headers, 'idempotency-key'));
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    if (signal?.aborted) throw new RequestCancelledError();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new RequestCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      setTimeout(cleanup, ms);
    });
  }

  private retryDelay(attempt: number, retryAfterSeconds?: number): number {
    if (retryAfterSeconds !== undefined) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAfterSeconds * 1_000));
    }
    const exponential = BASE_RETRY_DELAY_MS * 2 ** attempt;
    const jitter = Math.floor(Math.random() * BASE_RETRY_DELAY_MS);
    return Math.min(MAX_RETRY_DELAY_MS, exponential + jitter);
  }

  private buildBody(method: string, body: unknown): RequestBody {
    if (body === undefined || method === 'GET' || method === 'HEAD') return undefined;
    if (typeof body === 'string' || isFormData(body) || body instanceof Blob || body instanceof ArrayBuffer) {
      return body as BodyInit;
    }
    return JSON.stringify(body);
  }

  private async readResponseBody(response: Response): Promise<string> {
    if (typeof response.text === 'function') return response.text();
    const responseWithJson = response as Response & { json?: () => Promise<unknown> };
    if (typeof responseWithJson.json === 'function') {
      const value = await responseWithJson.json();
      if (value === undefined || value === null) return '';
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    return '';
  }

  private async performFetch(
    url: string,
    config: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    if (externalSignal?.aborted) throw new RequestCancelledError();

    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, { ...config, signal: controller.signal });
    } catch (error) {
      if (externalSignal?.aborted) throw new RequestCancelledError();
      if (timedOut || isAbortError(error)) {
        throw transportApiError('TIMEOUT', `Request timed out after ${timeoutMs}ms`, error);
      }
      throw transportApiError('NETWORK_ERROR', 'Network request failed', error);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method: requestedMethod = 'GET',
      body,
      headers: customHeaders,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      signal,
      maxRetries = DEFAULT_MAX_RETRIES,
      correlationId,
      authToken,
      errorFallback,
      _isRetry = false,
    } = options;
    const method = requestedMethod.toUpperCase();
    const requestAuthEpoch = this.authEpoch;
    const { url, authAllowed } = this.resolveUrl(path);
    const headers = this.buildHeaders(body, customHeaders, authAllowed, correlationId, authToken);
    const requestBody = this.buildBody(method, body);
    const config: RequestInit = requestBody === undefined
      ? { method, headers }
      : { method, headers, body: requestBody };
    const safeToRetry = this.canRetry(method, headers);
    const retryLimit = safeToRetry ? Math.max(0, Math.min(maxRetries, 4)) : 0;

    for (let attempt = 0; ; attempt++) {
      if (this.authEpoch !== requestAuthEpoch) throw new StaleAuthResponseError();

      let response: Response;
      try {
        response = await this.performFetch(url, config, Math.max(1, timeoutMs), signal);
      } catch (error) {
        if (
          error instanceof RequestCancelledError ||
          error instanceof StaleAuthResponseError ||
          attempt >= retryLimit ||
          !safeToRetry
        ) {
          throw error;
        }
        await this.delay(this.retryDelay(attempt), signal);
        continue;
      }

      if (this.authEpoch !== requestAuthEpoch) throw new StaleAuthResponseError();

      if (!response.ok) {
        const error = await apiErrorFromResponse(response, errorFallback);
        if (this.authEpoch !== requestAuthEpoch) throw new StaleAuthResponseError();

        if (response.status === 401) {
          if (this.isAuthEndpoint(path)) throw error;

          if (_isRetry) {
            this.clearAuthHandler?.();
            throw error;
          }

          if (this.refreshHandler) {
            const startEpoch = this.authEpoch;
            if (!this.refreshPromise) {
              const refresh = this.refreshHandler();
              const trackedRefresh = refresh.finally(() => {
                if (this.refreshPromise === trackedRefresh) this.refreshPromise = null;
              });
              this.refreshPromise = trackedRefresh;
            }

            const newToken = await this.refreshPromise;
            if (this.authEpoch !== startEpoch) throw error;

            if (newToken) {
              return this.request<T>(path, { ...options, authToken: undefined, _isRetry: true });
            }

            this.clearAuthHandler?.();
            throw error;
          }

          this.clearAuthHandler?.();
          throw error;
        }

        if (RETRYABLE_STATUS.has(response.status) && attempt < retryLimit && safeToRetry) {
          await this.delay(this.retryDelay(attempt, error.retryAfterSeconds), signal);
          continue;
        }
        throw error;
      }

      if (response.status === 204) return {} as T;

      const responseBody = await this.readResponseBody(response);
      if (this.authEpoch !== requestAuthEpoch) throw new StaleAuthResponseError();
      if (!responseBody) return {} as T;

      try {
        return JSON.parse(responseBody) as T;
      } catch {
        return responseBody as T;
      }
    }
  }

  public requestMultipart<T = any>(
    path: string,
    formData: FormData,
    options: Omit<RequestOptions, 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: options.method ?? 'POST', body: formData });
  }

  public upload<T = any>(
    path: string,
    formData: FormData,
    options: Omit<RequestOptions, 'body'> = {},
  ): Promise<T> {
    return this.requestMultipart<T>(path, formData, options);
  }

  public get<T = any>(path: string, headers?: Record<string, string>, options: Omit<RequestOptions, 'method' | 'headers'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET', headers });
  }

  public post<T = any>(path: string, body?: unknown, headers?: Record<string, string>, options: Omit<RequestOptions, 'method' | 'body' | 'headers'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body, headers });
  }

  public put<T = any>(path: string, body?: unknown, headers?: Record<string, string>, options: Omit<RequestOptions, 'method' | 'body' | 'headers'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body, headers });
  }

  public patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>, options: Omit<RequestOptions, 'method' | 'body' | 'headers'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body, headers });
  }

  public delete<T = any>(path: string, headers?: Record<string, string>, options: Omit<RequestOptions, 'method' | 'headers'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE', headers });
  }
}

export const apiClient = new ApiClient();