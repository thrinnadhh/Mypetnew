import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { AppError } from '../domain/result';
import { checkLocationPermissions, requestLocationPermissions } from './permissions';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  timestamp: number;
}

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    !isNaN(latitude) &&
    !isNaN(longitude) &&
    latitude >= -90.0 &&
    latitude <= 90.0 &&
    longitude >= -180.0 &&
    longitude <= 180.0
  );
}

export async function getCurrentCaptainLocation(): Promise<Coordinates> {
  if (Platform.OS === 'web') {
    return {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 10,
      timestamp: Date.now(),
    };
  }

  let permissions = await checkLocationPermissions();
  if (!permissions.foregroundGranted) {
    permissions = await requestLocationPermissions();
    if (!permissions.foregroundGranted) {
      throw AppError.fromHttp(403, {
        code: 'CAPTAIN_LOCATION_REQUIRED',
        message: 'Location permission is required to operate as Captain.',
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

    const { latitude, longitude, accuracy } = position.coords;
    if (!isValidCoordinate(latitude, longitude)) {
      throw AppError.fromHttp(400, {
        code: 'LOCATION_INVALID',
        message: 'Device reported invalid GPS coordinates.',
      });
    }

    return {
      latitude,
      longitude,
      accuracy,
      timestamp: position.timestamp,
    };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw AppError.fromHttp(400, {
      code: 'LOCATION_UNAVAILABLE',
      message: error.message || 'Unable to obtain current GPS location.',
    });
  }
}
