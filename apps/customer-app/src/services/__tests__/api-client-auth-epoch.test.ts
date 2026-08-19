import { apiClient, StaleAuthResponseError } from '../api-client';

describe('ApiClient auth generation response safety', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    apiClient.setSessionToken(null);
    apiClient.setRefreshHandler(null);
    apiClient.setClearAuthHandler(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('rejects a successful response that completes after an account-generation change', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as jest.MockedFunction<typeof fetch>;

    apiClient.setSessionToken('account-a-token');
    const pending = apiClient.get('/api/v1/customer/profile');

    apiClient.advanceAuthEpoch();
    apiClient.setSessionToken('account-b-token');
    resolveFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ name: 'Account A' }),
    } as Response);

    await expect(pending).rejects.toBeInstanceOf(StaleAuthResponseError);
  });

  it('still returns normal successful responses in the same auth generation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ name: 'Current account' }),
    } as Response);

    apiClient.setSessionToken('current-token');
    await expect(apiClient.get('/api/v1/customer/profile')).resolves.toEqual({ name: 'Current account' });
  });
});
