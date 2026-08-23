import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { ApiError, ErrorCodes } from '../../utils/errors';
import { checkLocationPermissions, requestLocationPermissions } from './location-permissions';

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
    // Default development coordinates (Bengaluru central)
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
      throw new ApiError({
        code: ErrorCodes.CAPTAIN_LOCATION_REQUIRED,
        message: 'Location permission is required to find delivery orders.',
        status: 403,
      });
    }
  }

  try {
    const isGpsEnabled = await Location.hasServicesEnabledAsync();
    if (!isGpsEnabled) {
      throw new ApiError({
        code: ErrorCodes.CAPTAIN_LOCATION_REQUIRED,
        message: 'Please enable device GPS / Location services.',
        status: 400,
      });
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const { latitude, longitude, accuracy } = position.coords;
    if (!isValidCoordinate(latitude, longitude)) {
      throw new ApiError({
        code: ErrorCodes.LOCATION_INVALID,
        message: 'Device reported invalid GPS coordinates.',
        status: 400,
      });
    }

    return {
      latitude,
      longitude,
      accuracy,
      timestamp: position.timestamp,
    };
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    throw new ApiError({
      code: ErrorCodes.CAPTAIN_LOCATION_REQUIRED,
      message: 'Unable to obtain current location. Please ensure GPS is enabled.',
      status: 400,
    });
  }
}
