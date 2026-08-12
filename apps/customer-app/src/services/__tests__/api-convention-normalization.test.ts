import { apiClient } from '../api-client';
import { fetchCustomerLoyaltyBalance } from '../loyalty';

describe('T1 API Convention Normalization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    apiClient.setSessionToken(null);
  });

  it('normalizes X-Idempotency-Key to canonical Idempotency-Key in ApiClient headers', async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation((_url, init) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    });

    apiClient.setSessionToken('test-token-123');
    await apiClient.post('/api/v1/test', { data: 1 }, { 'X-Idempotency-Key': 'key-abc-123' });

    expect(capturedHeaders.Accept).toBe('application/json');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders.Authorization).toBe('Bearer test-token-123');
    expect(capturedHeaders['Idempotency-Key']).toBe('key-abc-123');
  });

  it('formats fetchCustomerLoyaltyBalance to canonical /api/v1/customer/loyalty/{organizationId} endpoint', async () => {
    let requestedUrl = '';
    let authHeader = '';

    global.fetch = jest.fn().mockImplementation((url, init) => {
      requestedUrl = String(url);
      authHeader = (init?.headers as Record<string, string>)?.Authorization || '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            organizationId: 'org-uuid-123',
            availableStars: 10,
            rewards: 2,
          }),
          { status: 200 },
        ),
      );
    });

    const result = await fetchCustomerLoyaltyBalance('org-uuid-123', 'session-xyz');
    expect(requestedUrl).toContain('/api/v1/customer/loyalty/org-uuid-123');
    expect(authHeader).toBe('Bearer session-xyz');
    expect(result.availableStars).toBe(10);
    expect(result.rewards).toBe(2);
  });
});
