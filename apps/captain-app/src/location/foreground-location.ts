import * as Location from 'expo-location';
import {
  isCoordinateFresh,
  isValidCoordinate,
  LocationCoordinates,
} from '../domain/location-state';
import { AppError } from '../domain/result';
import { logger, sanitizeCoordinates } from '../utils/privacy';
import { checkLocationPermissions, requestForegroundLocationPermission } from './permissions';

export type Coordinates = LocationCoordinates;
export { isValidCoordinate, isCoordinateFresh };

export interface GetLocationOptions {
  maxAgeMs?: number;
  maxAccuracyMeters?: number;
  requestPermissionIfMissing?: boolean;
}

export async function getCurrentCaptainLocation(
  options: GetLocationOptions = {},
): Promise<Coordinates> {
  const {
    maxAgeMs = 60000,
    maxAccuracyMeters = 200,
    requestPermissionIfMissing = true,
  } = options;

  let permissions = await checkLocationPermissions();
  if (!permissions.foregroundGranted) {
    if (requestPermissionIfMissing) {
      permissions = await requestForegroundLocationPermission();
    }
    if (!permissions.foregroundGranted) {
      throw AppError.fromHttp(403, {
        code: 'CAPTAIN_LOCATION_REQUIRED',
        message: 'Foreground location permission is required to operate as Captain.',
      });
    }
  }

  try {
    const isGpsEnabled = await Location.hasServicesEnabledAsync();
    if (!isGpsEnabled) {
      throw AppError.fromHttp(400, {
        code: 'GPS_DISABLED',
        message: 'Please enable device GPS / Location services.',
      });
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const { latitude, longitude, accuracy, heading, speed } = position.coords;
    const timestamp = position.timestamp || Date.now();

    if (!isValidCoordinate(latitude, longitude)) {
      logger.warn('Location', `Invalid coordinates received: ${sanitizeCoordinates(latitude, longitude)}`);
      throw AppError.fromHttp(400, {
        code: 'LOCATION_INVALID',
        message: 'Device reported invalid GPS coordinates.',
      });
    }

    if (!isCoordinateFresh(timestamp, maxAgeMs)) {
      logger.warn('Location', `Stale coordinates fix received: age=${Date.now() - timestamp}ms`);
      throw AppError.fromHttp(400, {
        code: 'LOCATION_STALE',
        message: 'Location fix is stale. Please wait for fresh GPS reception.',
      });
    }

    if (accuracy != null && accuracy > maxAccuracyMeters) {
      logger.warn('Location', `Low GPS accuracy: ${accuracy}m > ${maxAccuracyMeters}m`);
    }

    return {
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      timestamp,
      heading: heading ?? null,
      speed: speed ?? null,
    };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Location', 'Failed to retrieve current GPS location', error);
    throw AppError.fromHttp(400, {
      code: 'LOCATION_UNAVAILABLE',
      message: error.message || 'Unable to obtain current GPS location.',
    });
  }
}
