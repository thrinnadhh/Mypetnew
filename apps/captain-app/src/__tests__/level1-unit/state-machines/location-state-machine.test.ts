import {
  calculateDistanceMeters,
  isCoordinateFresh,
  isValidCoordinate,
  LocationPermissionState,
} from '../../../domain/location-state';
import { computeLocationPermissionState } from '../../../location/permissions';

describe('Level 1: Location State Machine & Boundary Tests', () => {
  describe('Location Permission State Matrix', () => {
    it('computes UNKNOWN when services enabled and foreground not yet determined', () => {
      expect(computeLocationPermissionState(false, false, true, false)).toBe('UNKNOWN');
    });

    it('computes DENIED when foreground permission is rejected', () => {
      expect(computeLocationPermissionState(false, false, true, true)).toBe('DENIED');
      expect(computeLocationPermissionState(false, true, true, true)).toBe('DENIED');
    });

    it('computes FOREGROUND_ONLY when foreground granted but background missing', () => {
      expect(computeLocationPermissionState(true, false, true, true)).toBe('FOREGROUND_ONLY');
    });

    it('computes BACKGROUND_ALLOWED when both foreground and background granted', () => {
      expect(computeLocationPermissionState(true, true, true, true)).toBe('BACKGROUND_ALLOWED');
    });
  });

  describe('GPS Coordinate Boundaries & Sanitization', () => {
    it('validates valid geographical latitude and longitude bounds', () => {
      expect(isValidCoordinate(13.6288, 79.4192)).toBe(true);
      expect(isValidCoordinate(0, 0)).toBe(true);
      expect(isValidCoordinate(-90.0, -180.0)).toBe(true);
      expect(isValidCoordinate(90.0, 180.0)).toBe(true);
    });

    it('rejects invalid or out of bound coordinates', () => {
      expect(isValidCoordinate(90.0001, 0)).toBe(false);
      expect(isValidCoordinate(-90.0001, 0)).toBe(false);
      expect(isValidCoordinate(0, 180.0001)).toBe(false);
      expect(isValidCoordinate(0, -180.0001)).toBe(false);
      expect(isValidCoordinate(NaN, 79)).toBe(false);
      expect(isValidCoordinate(13, NaN)).toBe(false);
      expect(isValidCoordinate(Infinity, 79)).toBe(false);
      expect(isValidCoordinate(13, -Infinity)).toBe(false);
    });

    it('evaluates coordinate freshness against explicit time windows', () => {
      const now = 1700000000000;
      // 10 seconds ago -> fresh
      expect(isCoordinateFresh(now - 10000, 45000, now)).toBe(true);
      // 50 seconds ago (exceeds 45s threshold) -> stale
      expect(isCoordinateFresh(now - 50000, 45000, now)).toBe(false);
      // Invalid timestamps -> stale
      expect(isCoordinateFresh(0, 45000, now)).toBe(false);
      expect(isCoordinateFresh(NaN, 45000, now)).toBe(false);
    });

    it('calculates accurate distances with Haversine formula', () => {
      // Distance between Tirupati and Bengaluru (~210 km)
      const dist = calculateDistanceMeters(13.6288, 79.4192, 12.9716, 77.5946);
      expect(dist).toBeGreaterThan(200000);
      expect(dist).toBeLessThan(220000);

      // Identical coordinates -> 0 meters
      expect(calculateDistanceMeters(13.6288, 79.4192, 13.6288, 79.4192)).toBe(0);
    });
  });
});
