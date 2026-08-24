import * as Location from 'expo-location';
import {
  calculateDistanceMeters,
  isCoordinateFresh,
  isValidCoordinate,
  LocationPermissionState,
} from '../../domain/location-state';
import {
  getCurrentCaptainLocation,
} from '../../location/foreground-location';
import {
  checkLocationPermissions,
  computeLocationPermissionState,
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
} from '../../location/permissions';
import {
  isBackgroundLocationActive,
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../../location/background-location';
import { LocationUploader } from '../../location/location-uploader';
import { sanitizeAddress, sanitizeCoordinates, sanitizePhone } from '../../utils/privacy';

describe('Location Lifecycle & State Machine Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Permission State Machine', () => {
    it('computes correct permission states for all permutations', () => {
      expect(computeLocationPermissionState(false, false, true, false)).toBe('UNKNOWN');
      expect(computeLocationPermissionState(false, false, true, true)).toBe('DENIED');
      expect(computeLocationPermissionState(true, false, true, true, false)).toBe('APPROXIMATE_ONLY');
      expect(computeLocationPermissionState(true, false, true, true)).toBe('FOREGROUND_ONLY');
      expect(computeLocationPermissionState(true, true, true, true)).toBe('BACKGROUND_ALLOWED');
    });

    it('handles foreground permission denied gracefully', async () => {
      (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: true,
      });
      (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: true,
      });
      (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });

      const status = await checkLocationPermissions();
      expect(status.state).toBe<LocationPermissionState>('DENIED');
      expect(status.foregroundGranted).toBe(false);
      expect(status.backgroundGranted).toBe(false);

      await expect(getCurrentCaptainLocation()).rejects.toMatchObject({
        code: 'CAPTAIN_LOCATION_REQUIRED',
      });
    });

    it('handles background permission denied while keeping foreground granted', async () => {
      (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
      });
      (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: true,
      });
      (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: true,
      });

      const status = await checkLocationPermissions();
      expect(status.state).toBe<LocationPermissionState>('FOREGROUND_ONLY');
      expect(status.foregroundGranted).toBe(true);
      expect(status.backgroundGranted).toBe(false);

      const bgResult = await requestBackgroundLocationPermission();
      expect(bgResult.state).toBe<LocationPermissionState>('FOREGROUND_ONLY');
      expect(bgResult.backgroundGranted).toBe(false);

      // startBackgroundLocation should return false when background permission is missing
      const started = await startBackgroundLocation({ accountId: 'captain-location-test' });
      expect(started).toBe(false);
    });
  });

  describe('2. GPS Hardware & Fix Validation', () => {
    it('throws GPS_DISABLED when hardware location services are off', async () => {
      (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValueOnce(false);

      await expect(getCurrentCaptainLocation()).rejects.toMatchObject({
        code: 'GPS_DISABLED',
      });
    });

    it('validates coordinate boundaries strictly', () => {
      expect(isValidCoordinate(13.6288, 79.4192)).toBe(true);
      expect(isValidCoordinate(-90, -180)).toBe(true);
      expect(isValidCoordinate(90, 180)).toBe(true);

      expect(isValidCoordinate(90.1, 0)).toBe(false);
      expect(isValidCoordinate(-90.1, 0)).toBe(false);
      expect(isValidCoordinate(0, 180.1)).toBe(false);
      expect(isValidCoordinate(0, -180.1)).toBe(false);
      expect(isValidCoordinate(NaN, 79)).toBe(false);
      expect(isValidCoordinate(13, NaN)).toBe(false);
      expect(isValidCoordinate(Infinity, 79)).toBe(false);
    });

    it('rejects stale GPS coordinates', async () => {
      const now = Date.now();
      expect(isCoordinateFresh(now - 10000, 60000, now)).toBe(true);
      expect(isCoordinateFresh(now - 120000, 60000, now)).toBe(false);

      // Native returns 2 minutes old timestamp
      (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
        coords: {
          latitude: 13.6288,
          longitude: 79.4192,
          accuracy: 10,
        },
        timestamp: now - 120000,
      });

      await expect(getCurrentCaptainLocation({ maxAgeMs: 60000 })).rejects.toMatchObject({
        code: 'LOCATION_STALE',
      });
    });

    it('rejects an approximate fix instead of pretending dispatch tracking is precise', async () => {
      (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
        coords: {
          latitude: 13.6288,
          longitude: 79.4192,
          accuracy: 850,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      });

      await expect(getCurrentCaptainLocation()).rejects.toMatchObject({
        code: 'LOCATION_ACCURACY_INSUFFICIENT',
      });
    });
  });

  describe('3. Distance Calculation & Throttling Engine', () => {
    it('calculates accurate distance in meters using Haversine formula', () => {
      // 1 deg latitude is roughly 111km
      const d = calculateDistanceMeters(13.0, 77.0, 13.001, 77.0);
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(120);
    });

    it('throttles idle online uploads based on time and displacement', () => {
      const uploader = new LocationUploader({
        idleTimeIntervalMs: 25000,
        idleDistanceMeters: 25,
        minBurstIntervalMs: 4000,
      });

      const initialCoords = {
        latitude: 13.6288,
        longitude: 79.4192,
        accuracy: 10,
        timestamp: 100000,
      };

      // 1st fix should always upload
      expect(uploader.shouldUpload(initialCoords, 100000, false)).toBe(true);

      // Simulate successful upload
      (uploader as any).lastUploadedCoords = initialCoords;
      (uploader as any).lastUploadedAt = 100000;

      // 2s later, no displacement -> should NOT upload (within min burst)
      expect(uploader.shouldUpload(initialCoords, 102000, false)).toBe(false);

      // 10s later, small displacement (5 meters) -> should NOT upload
      const smallMove = {
        latitude: 13.62884,
        longitude: 79.4192,
        accuracy: 10,
        timestamp: 110000,
      };
      expect(uploader.shouldUpload(smallMove, 110000, false)).toBe(false);

      // 10s later, significant displacement (>25 meters) -> SHOULD upload
      const largeMove = {
        latitude: 13.6295,
        longitude: 79.4192,
        accuracy: 10,
        timestamp: 110000,
      };
      expect(uploader.shouldUpload(largeMove, 110000, false)).toBe(true);

      // 30s later (past maxInterval 25s), even without movement -> SHOULD upload
      expect(uploader.shouldUpload(initialCoords, 130000, false)).toBe(true);
    });

    it('adapts higher upload frequency during active delivery', () => {
      const uploader = new LocationUploader({
        idleTimeIntervalMs: 25000,
        idleDistanceMeters: 25,
        activeTimeIntervalMs: 10000,
        activeDistanceMeters: 15,
        minBurstIntervalMs: 3000,
      });

      const initialCoords = {
        latitude: 13.6288,
        longitude: 79.4192,
        accuracy: 10,
        timestamp: 100000,
      };

      (uploader as any).lastUploadedCoords = initialCoords;
      (uploader as any).lastUploadedAt = 100000;

      // 12s later, idle -> false, active delivery -> true (because 12s >= 10s active threshold)
      expect(uploader.shouldUpload(initialCoords, 112000, false)).toBe(false);
      expect(uploader.shouldUpload(initialCoords, 112000, true)).toBe(true);

      // 5s later, 18m move -> idle false (needs 25m), active true (needs 15m)
      const moderateMove = {
        latitude: 13.62896,
        longitude: 79.4192,
        accuracy: 10,
        timestamp: 105000,
      };
      expect(uploader.shouldUpload(moderateMove, 105000, false)).toBe(false);
      expect(uploader.shouldUpload(moderateMove, 105000, true)).toBe(true);
    });
  });

  describe('4. Background Tracking & Logout Cleanup', () => {
    it('starts and stops background location updates properly', async () => {
      (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
      });
      (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
      });

      const started = await startBackgroundLocation({ accountId: 'captain-location-test' });
      expect(started).toBe(true);
      expect(await isBackgroundLocationActive()).toBe(true);

      await stopBackgroundLocation();
      expect(await isBackgroundLocationActive()).toBe(false);
    });

    it('clears all operational coordinates and timers on logout', () => {
      const uploader = new LocationUploader();
      uploader.startTracking(true, false);

      expect((uploader as any).intervalId).not.toBeNull();

      // Logout / reset cache
      uploader.clearCache();

      expect((uploader as any).intervalId).toBeNull();
      expect(uploader.getLastKnownCoordinates()).toBeNull();
      expect(uploader.getLastUploadedCoordinates()).toBeNull();
    });
  });

  describe('5. Privacy & Data Minimization', () => {
    it('sanitizes coordinates preventing raw coordinate logging', () => {
      const sanitized = sanitizeCoordinates(13.628841, 79.419284);
      expect(sanitized).toBe('(lat: 13.62***, lon: 79.41***)');
      expect(sanitized).not.toContain('8841');
      expect(sanitized).not.toContain('9284');

      expect(sanitizeCoordinates(null, null)).toBe('[no coordinates]');
    });

    it('sanitizes customer address and phone numbers', () => {
      const address = 'Flat 402, Sunset Heights, 12th Main, Koramangala, Bangalore';
      const sanitizedAddr = sanitizeAddress(address);
      expect(sanitizedAddr).toBe('***, Bangalore');
      expect(sanitizedAddr).not.toContain('Flat 402');

      const phone = '+919876543210';
      const sanitizedPhone = sanitizePhone(phone);
      expect(sanitizedPhone).toBe('+919******10');
      expect(sanitizedPhone).not.toContain('8765432');
    });
  });
});
