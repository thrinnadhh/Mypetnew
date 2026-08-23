/**
 * Location and Availability State Machine Definitions
 *
 * Explicit domain types modeling:
 * 1. LocationPermissionState: Operating system permission posture
 * 2. CaptainLocationActivityState: Active GPS tracking lifecycle
 * 3. AvailabilityState: Server-authoritative Captain online presence
 */

export type LocationPermissionState =
  | 'UNKNOWN'
  | 'DENIED'
  | 'FOREGROUND_ONLY'
  | 'BACKGROUND_ALLOWED';

export type CaptainLocationActivityState =
  | 'STOPPED'
  | 'FOREGROUND_TRACKING'
  | 'BACKGROUND_TRACKING'
  | 'DEGRADED'
  | 'ERROR';

export type AvailabilityState =
  | 'OFFLINE'
  | 'GOING_ONLINE'
  | 'ONLINE'
  | 'GOING_OFFLINE'
  | 'BUSY';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  timestamp: number;
  heading?: number | null;
  speed?: number | null;
}

export interface LocationUploadPayload {
  online: boolean;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  capturedAt?: string | null;
  heading?: number | null;
  speed?: number | null;
}

/**
 * Validates coordinate sanity:
 * - Latitude: -90.0 to 90.0 (non-NaN, finite)
 * - Longitude: -180.0 to 180.0 (non-NaN, finite)
 */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !Number.isNaN(latitude) &&
    !Number.isNaN(longitude) &&
    latitude >= -90.0 &&
    latitude <= 90.0 &&
    longitude >= -180.0 &&
    longitude <= 180.0
  );
}

/**
 * Validates coordinate freshness (within maxAgeMs).
 */
export function isCoordinateFresh(timestamp: number, maxAgeMs = 60000, now = Date.now()): boolean {
  if (!timestamp || typeof timestamp !== 'number') return false;
  const age = now - timestamp;
  return age >= -10000 && age <= maxAgeMs;
}

/**
 * Calculates distance between two coordinates in meters using the Haversine formula.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMeters = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}
