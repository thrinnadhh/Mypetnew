import { ApiError, apiErrorFromResponse } from '../contracts/api-error';
import { appConfig } from '../utils/app-config';

export { ApiError } from '../contracts/api-error';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  _isRetry?: boolean;
}

export type RefreshHandler = () => Promise<string | null>;
export type ClearAuthHandler = () => void;

class ApiClient {
  private sessionToken: string | null = null;
  private refreshHandler: RefreshHandler | null = null;
  private clearAuthHandler: ClearAuthHandler | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private authEpoch = 0;

  public setSessionToken(token: string | null) {
    this.sessionToken = token;
    if (token === null) {
      this.advanceAuthEpoch();
    }
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

  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (customHeaders) {
      for (const [key, value] of Object.entries(customHeaders)) {
        if (key.toLowerCase() === 'x-idempotency-key') {
          headers['Idempotency-Key'] = value;
        } else {
          headers[key] = value;
        }
      }
    }

    if (this.sessionToken && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.sessionToken}`;
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

  public async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers: customHeaders, _isRetry = false } = options;
    const baseUrl = this.getBaseUrl();
    const url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

    const config: RequestInit = {
      method,
      headers: this.buildHeaders(customHeaders),
    };

    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      config.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await apiErrorFromResponse(response);

      if (response.status === 401) {
        // Auth lifecycle endpoints own their own failure semantics. Never recurse into refresh
        // and never let an old auth request clear a newer session generation.
        if (this.isAuthEndpoint(path)) {
          throw error;
        }

        if (_isRetry) {
          this.clearAuthHandler?.();
          throw error;
        }

        if (this.refreshHandler) {
          const startEpoch = this.authEpoch;

          if (!this.refreshPromise) {
            const refresh = this.refreshHandler();
            const trackedRefresh = refresh.finally(() => {
              if (this.refreshPromise === trackedRefresh) {
                this.refreshPromise = null;
              }
            });
            this.refreshPromise = trackedRefresh;
          }

          const activeRefresh = this.refreshPromise;
          const newToken = await activeRefresh;

          // A logout or a newly established login superseded this request. The old request
          // must fail without mutating the newer auth state.
          if (this.authEpoch !== startEpoch) {
            throw error;
          }

          if (newToken) {
            return this.request<T>(path, { ...options, _isRetry: true });
          }

          this.clearAuthHandler?.();
          throw error;
        }

        this.clearAuthHandler?.();
        throw error;
      }

      // 403 or any other non-401 error never triggers token refresh.
      throw error;
    }

    if (response.status === 204) return {} as T;

    const responseBody = await response.text();
    if (!responseBody) return {} as T;

    try {
      return JSON.parse(responseBody) as T;
    } catch {
      return responseBody as T;
    }
  }

  public get<T = any>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'GET', headers });
  }

  public post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, headers });
  }

  public put<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, headers });
  }

  public patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, headers });
  }

  public delete<T = any>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', headers });
  }
}

export const apiClient = new ApiClient();
