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

  it('clears auth state when refresh returns null without recursive loops', async () => {
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

  it('does NOT refresh or clear a newer session when an auth lifecycle endpoint returns 401', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const refreshHandler = jest.fn();
    const clearAuthHandler = jest.fn();

    apiClient.setRefreshHandler(refreshHandler);
    apiClient.setClearAuthHandler(clearAuthHandler);
    apiClient.setSessionToken('current-token');

    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));

    await expect(apiClient.delete('/api/v1/auth/sessions/current')).rejects.toThrow(ApiError);

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(clearAuthHandler).not.toHaveBeenCalled();
    expect(apiClient.getSessionToken()).toBe('current-token');
  });

  it('ignores a refresh result when signOut occurs while refresh is in-flight', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    apiClient.setSessionToken(null);
    resolveRefresh('late-new-token');

    await expect(requestPromise).rejects.toThrow(ApiError);
    expect(clearAuthHandler).not.toHaveBeenCalled();
    expect(apiClient.getSessionToken()).toBeNull();
  });

  it('never lets a stale refresh clear a newly established login generation', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('session-a-token');

    let resolveRefresh: (val: string | null) => void = () => {};
    const oldRefresh = new Promise<string | null>((resolve) => {
      resolveRefresh = resolve;
    });

    const refreshHandler = jest.fn().mockImplementation(() => oldRefresh);
    const clearAuthHandler = jest.fn();
    apiClient.setRefreshHandler(refreshHandler);
    apiClient.setClearAuthHandler(clearAuthHandler);

    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));
    const oldRequest = apiClient.get('/api/v1/session-a-resource');
    await new Promise((resolve) => setTimeout(resolve, 0));

    apiClient.advanceAuthEpoch();
    apiClient.setSessionToken('session-b-token');
    resolveRefresh('stale-session-a-rotated-token');

    await expect(oldRequest).rejects.toThrow(ApiError);
    expect(clearAuthHandler).not.toHaveBeenCalled();
    expect(apiClient.getSessionToken()).toBe('session-b-token');
  });

  it('does not let an old refresh finalizer drop a newer in-flight refresh', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    apiClient.setSessionToken('session-a-token');

    let resolveA: (val: string | null) => void = () => {};
    let resolveB: (val: string | null) => void = () => {};
    const refreshA = new Promise<string | null>((resolve) => { resolveA = resolve; });
    const refreshB = new Promise<string | null>((resolve) => { resolveB = resolve; });
    const refreshHandler = jest.fn()
      .mockImplementationOnce(() => refreshA)
      .mockImplementationOnce(() => refreshB);
    apiClient.setRefreshHandler(refreshHandler);

    fetchMock
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401))
      .mockResolvedValueOnce(mockResponse({ ok: 'b' }, 200))
      .mockResolvedValueOnce(mockResponse({ ok: 'c' }, 200));

    const requestA = apiClient.get('/api/v1/a');
    await new Promise((resolve) => setTimeout(resolve, 0));

    apiClient.advanceAuthEpoch();
    apiClient.setSessionToken('session-b-token');
    const requestB = apiClient.get('/api/v1/b');
    await new Promise((resolve) => setTimeout(resolve, 0));

    resolveA('stale-a-token');
    await expect(requestA).rejects.toThrow(ApiError);

    const requestC = apiClient.get('/api/v1/c');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshHandler).toHaveBeenCalledTimes(2);

    apiClient.setSessionToken('rotated-b-token');
    resolveB('rotated-b-token');

    await expect(requestB).resolves.toEqual({ ok: 'b' });
    await expect(requestC).resolves.toEqual({ ok: 'c' });
    expect(refreshHandler).toHaveBeenCalledTimes(2);
  });
});
