import { apiClient, ApiError, RequestCancelledError } from '../api-client';

describe('ApiClient production transport behavior', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    apiClient.setSessionToken(null);
    apiClient.setRefreshHandler(null);
    apiClient.setClearAuthHandler(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    } as Response;
  }

  it('retries safe reads for retryable responses and respects Retry-After', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce(response({ code: 'TEMPORARY' }, 503, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response({ ok: true }));

    await expect(apiClient.get('/api/v1/catalog')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never automatically replays a non-idempotent mutation without an idempotency key', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(response({ code: 'TEMPORARY' }, 503, { 'retry-after': '0' }));

    await expect(apiClient.post('/api/v1/orders', { listingId: 'listing-1' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('may retry an explicitly idempotent mutation with a stable Idempotency-Key', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce(response({ code: 'TEMPORARY' }, 503, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response({ id: 'order-1' }));

    await expect(
      apiClient.post('/api/v1/orders', { listingId: 'listing-1' }, { 'Idempotency-Key': 'order-create-1' }),
    ).resolves.toEqual({ id: 'order-1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(firstHeaders['Idempotency-Key']).toBe('order-create-1');
    expect(secondHeaders['Idempotency-Key']).toBe('order-create-1');
  });

  it('does not force JSON Content-Type for multipart FormData and preserves auth', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(response({ uploaded: true }));
    apiClient.setSessionToken('multipart-token');
    const form = new FormData();
    form.append('kind', 'medical-document');

    await apiClient.upload('/api/v1/customer/documents', form);

    const options = fetchMock.mock.calls[0][1];
    const headers = options?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer multipart-token');
    expect(options?.body).toBe(form);
  });

  it('times out through AbortController with a timeout-specific ApiError', async () => {
    jest.useFakeTimers();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = apiClient.get('/api/v1/slow', undefined, { timeoutMs: 10, maxRetries: 0 });
    jest.advanceTimersByTime(11);

    await expect(pending).rejects.toMatchObject({ name: 'ApiTimeoutError', code: 'TIMEOUT', status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors caller cancellation without issuing a request when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(apiClient.get('/api/v1/profile', undefined, { signal: controller.signal })).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never leaks the backend bearer token to an unrelated absolute origin', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    apiClient.setSessionToken('backend-only-token');

    await apiClient.get('https://example.invalid/platform-boundary');

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
