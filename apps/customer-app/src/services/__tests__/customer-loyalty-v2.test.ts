import { fetchCustomerLoyaltyBalance } from '../loyalty';

describe('customer loyalty v2 reward projection', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads merchant-scoped reward values from the canonical v2 endpoint', async () => {
    let requestedUrl = '';
    let authorization = '';
    global.fetch = jest.fn().mockImplementation((url, init) => {
      requestedUrl = String(url);
      authorization = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            organizationId: 'org-123',
            availableStars: 0,
            rewards: [
              {
                rewardId: 'reward-123',
                valuePaise: 5000,
                status: 'ISSUED',
                issuedAt: '2026-08-16T00:00:00Z',
                expiresAt: '2026-11-14T00:00:00Z',
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    const result = await fetchCustomerLoyaltyBalance('org-123', 'token-123');

    expect(requestedUrl).toContain('/api/v2/customer/loyalty/org-123');
    expect(authorization).toBe('Bearer token-123');
    expect(result.availableStars).toBe(0);
    expect(result.rewards).toEqual([
      expect.objectContaining({ rewardId: 'reward-123', valuePaise: 5000, status: 'ISSUED' }),
    ]);
  });
});
