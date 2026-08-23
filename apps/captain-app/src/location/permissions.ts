import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface LocationPermissionStatus {
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  canAskAgain: boolean;
}

export async function checkLocationPermissions(): Promise<LocationPermissionStatus> {
  if (Platform.OS === 'web') {
    return { foregroundGranted: true, backgroundGranted: true, canAskAgain: true };
  }

  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();

  return {
    foregroundGranted: foreground.granted || foreground.status === 'granted',
    backgroundGranted: background.granted || background.status === 'granted',
    canAskAgain: foreground.canAskAgain,
  };
}

export async function requestLocationPermissions(): Promise<LocationPermissionStatus> {
  if (Platform.OS === 'web') {
    return { foregroundGranted: true, backgroundGranted: true, canAskAgain: true };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  let backgroundGranted = false;

  if (foreground.granted || foreground.status === 'granted') {
    try {
      const background = await Location.requestBackgroundPermissionsAsync();
      backgroundGranted = background.granted || background.status === 'granted';
    } catch {
      // Background request may not be supported on all device profiles
    }
  }

  return {
    foregroundGranted: foreground.granted || foreground.status === 'granted',
    backgroundGranted,
    canAskAgain: foreground.canAskAgain,
  };
}
