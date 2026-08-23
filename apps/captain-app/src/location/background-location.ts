import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { Coordinates } from './foreground-location';

export const CAPTAIN_BACKGROUND_LOCATION_TASK = 'MYPET_CAPTAIN_BACKGROUND_LOCATION';

export async function isBackgroundLocationActive(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
    }
  } catch {
    // Ignore
  }
}

export type LocationCallback = (coords: Coordinates) => void;
