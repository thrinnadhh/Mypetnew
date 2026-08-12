import { ApiError, apiErrorFromResponse } from '../contracts/api-error';
import { appConfig } from '../utils/app-config';

export { ApiError } from '../contracts/api-error';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiClient {
  private sessionToken: string | null = null;

  public setSessionToken(token: string | null) {
    this.sessionToken = token;
  }

  private getBaseUrl(): string {
    return appConfig.apiBaseUrl || 'http://localhost:8080';
  }

  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders || {}),
    };

    if (this.sessionToken) {
      headers.Authorization = `Bearer ${this.sessionToken}`;
    }

    return headers;
  }

  public async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers: customHeaders } = options;
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
    if (!response.ok) throw await apiErrorFromResponse(response);
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
