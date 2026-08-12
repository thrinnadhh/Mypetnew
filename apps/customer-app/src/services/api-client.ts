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
      this.authEpoch++;
      this.refreshPromise = null;
    }
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

      // Handle 401 Authentication Required
      if (response.status === 401) {
        // Do NOT refresh if auth endpoint or already retried
        if (this.isAuthEndpoint(path) || _isRetry) {
          if (this.clearAuthHandler) {
            this.clearAuthHandler();
          }
          throw error;
        }

        if (this.refreshHandler) {
          const startEpoch = this.authEpoch;
          // Coalesce concurrent 401 requests into ONE in-flight refresh Promise
          if (!this.refreshPromise) {
            this.refreshPromise = this.refreshHandler().finally(() => {
              this.refreshPromise = null;
            });
          }

          const activeRefresh = this.refreshPromise;
          const newToken = await activeRefresh;
          if (newToken && this.authEpoch === startEpoch) {
            return this.request<T>(path, { ...options, _isRetry: true });
          } else {
            if (this.clearAuthHandler) {
              this.clearAuthHandler();
            }
            throw error;
          }
        } else {
          if (this.clearAuthHandler) {
            this.clearAuthHandler();
          }
          throw error;
        }
      }

      // 403 or other non-401 error: NEVER refresh!
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
