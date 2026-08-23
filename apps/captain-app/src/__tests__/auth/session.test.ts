import {
  clearSession,
  getStoredRefreshState,
  getRuntimeAccessToken,
  refreshCaptainSession,
  storeSession,
} from '../../auth/session';
import { CaptainSessionEnvelope } from '../../auth/types';

describe('Captain Session Management', () => {
  beforeEach(async () => {
    await clearSession();
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const validCaptainSession: CaptainSessionEnvelope = {
    accountId: 'captain-acc-1',
    accessToken: 'valid-access-token',
    refreshToken: 'valid-refresh-token',
    accessTokenExpiresAt: '2026-08-23T12:00:00Z',
    refreshTokenExpiresAt: '2026-09-23T12:00:00Z',
    role: 'CAPTAIN',
  };

  it('stores valid CAPTAIN session and sets runtime access token', async () => {
    await storeSession(validCaptainSession);
    expect(getRuntimeAccessToken()).toBe('valid-access-token');
  });

  it('rejects sessions with non-CAPTAIN roles (e.g. CUSTOMER / MERCHANT)', async () => {
    const invalidSession = {
      ...validCaptainSession,
      role: 'CUSTOMER',
    };

    await expect(storeSession(invalidSession)).rejects.toThrow(
      'Invalid role for Captain application',
    );
  });

  it('clears session and resets runtime access token', async () => {
    await storeSession(validCaptainSession);
    expect(getRuntimeAccessToken()).toBe('valid-access-token');

    await clearSession();
    expect(getRuntimeAccessToken()).toBeNull();
  });

  it('handles token refresh correctly when refreshToken exists', async () => {
    // Mock stored refresh state
    jest.spyOn(require('expo-secure-store'), 'getItemAsync').mockResolvedValue(
      JSON.stringify({
        version: 1,
        accountId: 'captain-acc-1',
        refreshToken: 'valid-refresh-token',
        refreshTokenExpiresAt: '2026-09-23T12:00:00Z',
      }),
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: 'captain-acc-1',
        accessToken: 'refreshed-token',
        refreshToken: 'new-refresh-token',
        accessTokenExpiresAt: '2026-08-23T13:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T13:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    const refreshed = await refreshCaptainSession();
    expect(refreshed.accessToken).toBe('refreshed-token');
    expect(getRuntimeAccessToken()).toBe('refreshed-token');
  });
});
