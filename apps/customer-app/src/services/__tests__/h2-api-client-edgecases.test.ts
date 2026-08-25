import { apiClient } from '../api-client';
import { fetchCustomerOrderPage } from '../customer-order-list';
import { appConfig } from '../../utils/app-config';

/**
 * H2 adversarial transport regressions. These tests drive the real ApiClient
 * against stubbed global.fetch (same idiom as api-client-transport.test.ts).
 *
 * Mutation notes:
 * - Removing the origin compare in resolveUrl fails the SUPPRESSED cases.
 * - Returning parsed JSON for non-JSON bodies or weakening validatePage fails
 *   the fail-closed case.
 * - Treating a garbage Retry-After as a number (NaN delay) breaks the bounded
 *   backoff timing assertions.
 */
describe('H2 ApiClient transport edgecases', () => {
  const originalFetch = global.fetch;
  const originalApiBaseUrl = appConfig.apiBaseUrl;

  beforeEach(() => {
    apiClient.setSessionToken(null);
    apiClient.setRefreshHandler(null);
    apiClient.setClearAuthHandler(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    appConfig.apiBaseUrl = originalApiBaseUrl;
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    } as unknown as Response;
  }

  function lastHeaders(): Record<string, string> {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1];
    return (init?.headers ?? {}) as Record<string, string>;
  }

  describe('cross-origin bearer suppression matrix', () => {
    beforeEach(() => {
      apiClient.setSessionToken('h2-bearer-token');
    });

    it('sends Authorization to an absolute URL on the backend origin', async () => {
      const baseOrigin = new URL(appConfig.apiBaseUrl.replace(/\/+$/, '')).origin;
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await expect(apiClient.get(`${baseOrigin}/api/v1/customer/profile`)).resolves.toEqual({ ok: true });

      expect(lastHeaders().Authorization).toBe('Bearer h2-bearer-token');
    });

    it('suppresses Authorization for an absolute URL on an unrelated origin', async () => {
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await expect(apiClient.get('https://unrelated.example.invalid/api/v1/customer/profile')).resolves.toEqual({
        ok: true,
      });

      expect(lastHeaders().Authorization).toBeUndefined();
    });

    it('suppresses Authorization for a subdomain of the backend host', async () => {
      // Origin equality is exact: a sibling subdomain must never receive the bearer.
      const baseOrigin = new URL(appConfig.apiBaseUrl.replace(/\/+$/, '')).origin;
      const subdomainUrl = `${baseOrigin.replace('://', '://sub.')}/api/v1/customer/profile`;
      expect(new URL(subdomainUrl).origin).not.toBe(baseOrigin);

      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await expect(apiClient.get(subdomainUrl)).resolves.toEqual({ ok: true });

      expect(lastHeaders().Authorization).toBeUndefined();
    });

    it('normalizes trailing slashes off the base URL and keeps auth on relative paths', async () => {
      appConfig.apiBaseUrl = 'http://127.0.0.1:9999///';
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await expect(apiClient.get('/api/v1/relative')).resolves.toEqual({ ok: true });

      const [requestedUrl] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect(requestedUrl).toBe('http://127.0.0.1:9999/api/v1/relative');
      expect(lastHeaders().Authorization).toBe('Bearer h2-bearer-token');
    });

    it('treats an http vs https scheme mismatch as a different origin and suppresses auth', async () => {
      const baseUrl = appConfig.apiBaseUrl.replace(/\/+$/, '');
      const flippedSchemeUrl = baseUrl.startsWith('https://')
        ? `${baseUrl.replace('https://', 'http://')}/api/v1/customer/profile`
        : `${baseUrl.replace('http://', 'https://')}/api/v1/customer/profile`;
      expect(new URL(flippedSchemeUrl).origin).not.toBe(new URL(baseUrl).origin);

      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await expect(apiClient.get(flippedSchemeUrl)).resolves.toEqual({ ok: true });

      expect(lastHeaders().Authorization).toBeUndefined();
    });
  });

  describe('HTTP 200 with a non-JSON body', () => {
    const htmlBody = '<html><body>502 Bad Gateway</body></html>';

    it('resolves with the raw string payload at the transport layer (documented behavior)', async () => {
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValueOnce(jsonResponse(htmlBody));

      const result = await apiClient.get('/api/v1/customer/orders');

      expect(result).toBe(htmlBody);
      expect(typeof result).toBe('string');
    });

    it('fails closed in the canonical order-list validator instead of surfacing HTML as orders', async () => {
      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock.mockResolvedValue(jsonResponse(htmlBody));

      await expect(fetchCustomerOrderPage('access-token')).rejects.toThrow(
        'Order service returned an invalid page.',
      );
    });
  });

  describe('malformed Retry-After on 503', () => {
    it('falls back to bounded exponential backoff and recovers without crashing', async () => {
      // Zero jitter makes the backoff deterministic: attempt 0 -> 250ms, attempt 1 -> 500ms.
      jest.spyOn(Math, 'random').mockReturnValue(0);
      jest.useFakeTimers();

      const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 'TEMPORARY' }, 503, { 'retry-after': 'soon-ish, maybe' }))
        .mockResolvedValueOnce(jsonResponse({ code: 'TEMPORARY' }, 503, { 'retry-after': 'garbage' }))
        .mockResolvedValueOnce(jsonResponse({ recovered: true }));

      const pending = apiClient.get('/api/v1/flaky');

      await jest.advanceTimersByTimeAsync(250);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // A NaN delay from the garbage header would fire immediately; pinning the
      // full second backoff window proves the fallback stayed exponential.
      await jest.advanceTimersByTimeAsync(499);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ recovered: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
