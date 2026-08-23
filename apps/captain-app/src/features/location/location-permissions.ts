import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface LocationPermissionStatus {
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  canAskAgain: boolean;
}

export async function checkLocationPermissions(): Promise<LocationPermissionStatus> {
  if (Platform.OS === 'web') {
    return {
      foregroundGranted: true,
      backgroundGranted: true,
      canAskAgain: true,
    };
  }

  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    let backgroundGranted = false;
    if (foreground.granted) {
      try {
        const background = await Location.getBackgroundPermissionsAsync();
        backgroundGranted = background.granted;
      } catch {
        backgroundGranted = false;
      }
    }

    return {
      foregroundGranted: foreground.granted,
      backgroundGranted,
      canAskAgain: foreground.canAskAgain,
    };
  } catch {
    return {
      foregroundGranted: false,
      backgroundGranted: false,
      canAskAgain: true,
    };
  }
}

export async function requestLocationPermissions(): Promise<LocationPermissionStatus> {
  if (Platform.OS === 'web') {
    return {
      foregroundGranted: true,
      backgroundGranted: true,
      canAskAgain: true,
    };
  }

  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    let backgroundGranted = false;

    if (foreground.granted) {
      try {
        const background = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = background.granted;
      } catch {
        backgroundGranted = false;
      }
    }

    return {
      foregroundGranted: foreground.granted,
      backgroundGranted,
      canAskAgain: foreground.canAskAgain,
    };
  } catch {
    return {
      foregroundGranted: false,
      backgroundGranted: false,
      canAskAgain: true,
    };
  }
}
