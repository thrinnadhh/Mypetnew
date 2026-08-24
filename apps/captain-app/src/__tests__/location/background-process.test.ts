import * as Location from 'expo-location';
import { publishCaptainLocation } from '../../api/availability';
import { clearSession, storeSession } from '../../auth/session';
import {
  processBackgroundLocationBatch,
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../../location/background-location';

jest.mock('../../api/availability', () => ({
  publishCaptainLocation: jest.fn().mockResolvedValue({ online: true }),
}));

const sessionFor = (accountId: string) => ({
  accountId,
  accessToken: `${accountId}-access`,
  refreshToken: `${accountId}-refresh`,
  accessTokenExpiresAt: '2026-08-24T12:00:00Z',
  refreshTokenExpiresAt: '2026-09-24T12:00:00Z',
  role: 'CAPTAIN',
});

describe('process-death-safe background location', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await stopBackgroundLocation();
    await clearSession();
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
  });

  it('publishes a valid headless fix for the persisted active Captain session', async () => {
    await storeSession(sessionFor('captain-a'));
    await expect(startBackgroundLocation({
      accountId: 'captain-a',
      online: true,
      activeDelivery: true,
    })).resolves.toBe(true);

    await expect(processBackgroundLocationBatch({
      locations: [{
        coords: {
          latitude: 13.6288,
          longitude: 79.4192,
          accuracy: 12,
          heading: 90,
          speed: 4,
        },
        timestamp: Date.now(),
      }],
    })).resolves.toBe(true);

    expect(publishCaptainLocation).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 13.6288,
      longitude: 79.4192,
    }));
  });

  it('rejects stale fixes and old-account telemetry after an account switch', async () => {
    await storeSession(sessionFor('captain-a'));
    await startBackgroundLocation({ accountId: 'captain-a', online: true });

    await expect(processBackgroundLocationBatch({
      locations: [{
        coords: { latitude: 13.6288, longitude: 79.4192, accuracy: 12 },
        timestamp: Date.now() - 180_000,
      }],
    })).resolves.toBe(false);

    await storeSession(sessionFor('captain-b'));
    await expect(processBackgroundLocationBatch({
      locations: [{
        coords: { latitude: 13.6288, longitude: 79.4192, accuracy: 12 },
        timestamp: Date.now(),
      }],
    })).resolves.toBe(false);
    expect(publishCaptainLocation).not.toHaveBeenCalled();
  });

  it('stops publishing after tracking state is cleared on logout cleanup', async () => {
    await storeSession(sessionFor('captain-a'));
    await startBackgroundLocation({ accountId: 'captain-a', online: true });
    await stopBackgroundLocation();

    await expect(processBackgroundLocationBatch({
      locations: [{
        coords: { latitude: 13.6288, longitude: 79.4192, accuracy: 12 },
        timestamp: Date.now(),
      }],
    })).resolves.toBe(false);
    expect(publishCaptainLocation).not.toHaveBeenCalled();
  });
});
