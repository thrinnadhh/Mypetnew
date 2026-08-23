import * as Location from 'expo-location';
import { LocationPermissionState } from '../domain/location-state';
import { logger } from '../utils/privacy';

export interface LocationPermissionStatus {
  state: LocationPermissionState;
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  canAskAgain: boolean;
}

export function computeLocationPermissionState(
  foregroundGranted: boolean,
  backgroundGranted: boolean,
  canAskAgain: boolean,
  checked = true,
): LocationPermissionState {
  if (!checked) return 'UNKNOWN';
  if (!foregroundGranted) {
    return 'DENIED';
  }
  if (backgroundGranted) {
    return 'BACKGROUND_ALLOWED';
  }
  return 'FOREGROUND_ONLY';
}

export async function checkLocationPermissions(): Promise<LocationPermissionStatus> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();

    const foregroundGranted = !!(foreground && (foreground.granted || foreground.status === 'granted'));
    const backgroundGranted = !!(background && (background.granted || background.status === 'granted'));
    const canAskAgain = foreground?.canAskAgain ?? true;

    return {
      state: computeLocationPermissionState(foregroundGranted, backgroundGranted, canAskAgain, true),
      foregroundGranted,
      backgroundGranted,
      canAskAgain,
    };
  } catch (error) {
    logger.error('Permissions', 'Failed to check location permissions', error);
    return {
      state: 'DENIED',
      foregroundGranted: false,
      backgroundGranted: false,
      canAskAgain: true,
    };
  }
}

/**
 * Step 1: Request Foreground Location Permission
 * (Required to go online and receive nearby dispatch offers)
 */
export async function requestForegroundLocationPermission(): Promise<LocationPermissionStatus> {
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    const foregroundGranted = !!(foreground && (foreground.granted || foreground.status === 'granted'));

    let backgroundGranted = false;
    if (foregroundGranted) {
      const background = await Location.getBackgroundPermissionsAsync();
      backgroundGranted = !!(background && (background.granted || background.status === 'granted'));
    }

    return {
      state: computeLocationPermissionState(foregroundGranted, backgroundGranted, foreground.canAskAgain, true),
      foregroundGranted,
      backgroundGranted,
      canAskAgain: foreground.canAskAgain,
    };
  } catch (error) {
    logger.error('Permissions', 'Failed to request foreground location permission', error);
    return {
      state: 'DENIED',
      foregroundGranted: false,
      backgroundGranted: false,
      canAskAgain: false,
    };
  }
}

/**
 * Step 2: Request Background Location Permission
 * (Requested only after foreground is granted, with contextual explanation for active delivery tracking)
 */
export async function requestBackgroundLocationPermission(): Promise<LocationPermissionStatus> {
  const current = await checkLocationPermissions();
  if (!current.foregroundGranted) {
    const fg = await requestForegroundLocationPermission();
    if (!fg.foregroundGranted) {
      return fg;
    }
  }

  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    const backgroundGranted = !!(background && (background.granted || background.status === 'granted'));

    return {
      state: computeLocationPermissionState(true, backgroundGranted, background.canAskAgain, true),
      foregroundGranted: true,
      backgroundGranted,
      canAskAgain: background.canAskAgain,
    };
  } catch (error) {
    logger.error('Permissions', 'Failed to request background location permission', error);
    return {
      state: 'FOREGROUND_ONLY',
      foregroundGranted: true,
      backgroundGranted: false,
      canAskAgain: false,
    };
  }
}

/**
 * Convenience helper for full permission check and request
 */
export async function requestLocationPermissions(): Promise<LocationPermissionStatus> {
  const fg = await requestForegroundLocationPermission();
  if (!fg.foregroundGranted) {
    return fg;
  }
  return await requestBackgroundLocationPermission();
}
