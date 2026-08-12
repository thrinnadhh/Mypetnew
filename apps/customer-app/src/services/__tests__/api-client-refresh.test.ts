import { ApiError, apiClient } from '../api-client';

describe('ApiClient central token refresh & security behavior', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    apiClient.setSessionToken(null);
    apiClient.setRefreshHandler(null);
    apiClient.setClearAuthHandler(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function mockResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }

  it('injects Bearer token into Authorization header when sessionToken is set', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(mockResponse({ data: 'ok' }));

    apiClient.setSessionToken('active-access-token');
    await apiClient.get('/api/v1/test');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders.Authorization).toBe('Bearer active-access-token');
  });

  it('coalesces concurrent 401 requests into ONE in-flight refresh Promise and retries ONCE', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('expired-access-token');

    let refreshCallCount = 0;
    const refreshHandler = jest.fn().mockImplementation(async () => {
      refreshCallCount++;
      apiClient.setSessionToken('new-rotated-access-token');
      return 'new-rotated-access-token';
    });
    apiClient.setRefreshHandler(refreshHandler);

    fetchMock
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ res: 'req1-ok' }, 200))
      .mockResolvedValueOnce(mockResponse({ res: 'req2-ok' }, 200))
      .mockResolvedValueOnce(mockResponse({ res: 'req3-ok' }, 200));

    const p1 = apiClient.get('/api/v1/resource1');
    const p2 = apiClient.get('/api/v1/resource2');
    const p3 = apiClient.get('/api/v1/resource3');

    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual([{ res: 'req1-ok' }, { res: 'req2-ok' }, { res: 'req3-ok' }]);
    expect(refreshCallCount).toBe(1);
    expect(refreshHandler).toHaveBeenCalledTimes(1);
  });

  it('NEVER triggers refresh on 403 Forbidden', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('valid-token-insufficient-role');

    const refreshHandler = jest.fn();
    apiClient.setRefreshHandler(refreshHandler);

    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'ACCESS_DENIED' }, 403));

    await expect(apiClient.get('/api/v1/merchant/protected')).rejects.toThrow(ApiError);
    expect(refreshHandler).not.toHaveBeenCalled();
  });

  it('clears auth state when refresh returns null or fails without recursive loops', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('dead-token');

    const clearAuthHandler = jest.fn();
    const refreshHandler = jest.fn().mockResolvedValue(null);

    apiClient.setRefreshHandler(refreshHandler);
    apiClient.setClearAuthHandler(clearAuthHandler);

    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));

    await expect(apiClient.get('/api/v1/resource')).rejects.toThrow(ApiError);
    expect(refreshHandler).toHaveBeenCalledTimes(1);
    expect(clearAuthHandler).toHaveBeenCalledTimes(1);
  });

  it('clears auth state when retried request still returns 401 without infinite retry loops', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('stale-token');

    const clearAuthHandler = jest.fn();
    const refreshHandler = jest.fn().mockResolvedValue('token-that-is-still-rejected');

    apiClient.setRefreshHandler(refreshHandler);
    apiClient.setClearAuthHandler(clearAuthHandler);

    fetchMock
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));

    await expect(apiClient.get('/api/v1/resource')).rejects.toThrow(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshHandler).toHaveBeenCalledTimes(1);
    expect(clearAuthHandler).toHaveBeenCalledTimes(1);
  });

  it('does NOT attempt refresh when DELETE /api/v1/auth/sessions/current returns 401', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const refreshHandler = jest.fn();
    const clearAuthHandler = jest.fn();

    apiClient.setRefreshHandler(refreshHandler);
    apiClient.setClearAuthHandler(clearAuthHandler);

    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));

    await expect(apiClient.delete('/api/v1/auth/sessions/current')).rejects.toThrow(ApiError);

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(clearAuthHandler).toHaveBeenCalledTimes(1);
  });

  it('ignores refresh result if signOut/setSessionToken(null) occurs while refresh is in-flight', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('expiring-token');

    let resolveRefresh: (val: string | null) => void = () => {};
    const refreshPromise = new Promise<string | null>((resolve) => {
      resolveRefresh = resolve;
    });

    const refreshHandler = jest.fn().mockImplementation(() => refreshPromise);
    const clearAuthHandler = jest.fn();
    apiClient.setRefreshHandler(refreshHandler);
    apiClient.setClearAuthHandler(clearAuthHandler);

    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));

    const requestPromise = apiClient.get('/api/v1/protected-data');

    // Allow fetch & response reading to complete microtasks
    await new Promise((r) => setTimeout(r, 0));

    // Simulate user signing out while refresh is in-flight
    apiClient.setSessionToken(null);

    // Resolve the in-flight refresh with a new token
    resolveRefresh('late-new-token');

    await expect(requestPromise).rejects.toThrow();
    expect(clearAuthHandler).toHaveBeenCalled();
  });
});
