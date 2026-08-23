import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Coordinates } from './foreground-location';
import { checkLocationPermissions } from './permissions';
import { logger, sanitizeCoordinates } from '../utils/privacy';

export const CAPTAIN_BACKGROUND_LOCATION_TASK = 'MYPET_CAPTAIN_BACKGROUND_LOCATION';

export type BackgroundLocationListener = (coords: Coordinates) => Promise<void> | void;

const backgroundListeners: Set<BackgroundLocationListener> = new Set();

export function addBackgroundLocationListener(listener: BackgroundLocationListener): () => void {
  backgroundListeners.add(listener);
  return () => {
    backgroundListeners.delete(listener);
  };
}

// Define the native background task using TaskManager
try {
  TaskManager.defineTask(
    CAPTAIN_BACKGROUND_LOCATION_TASK,
    async ({ data, error }: { data: any; error: any }) => {
      if (error) {
        logger.error('BackgroundLocation', 'Background location error', error);
        return;
      }

      if (data && data.locations && data.locations.length > 0) {
        const rawLocation = data.locations[data.locations.length - 1];
        const coords: Coordinates = {
          latitude: rawLocation.coords.latitude,
          longitude: rawLocation.coords.longitude,
          accuracy: rawLocation.coords.accuracy ?? null,
          timestamp: rawLocation.timestamp || Date.now(),
          heading: rawLocation.coords.heading ?? null,
          speed: rawLocation.coords.speed ?? null,
        };

        logger.debug(
          'BackgroundLocation',
          `Received background fix: ${sanitizeCoordinates(coords.latitude, coords.longitude)}`,
        );

        for (const listener of backgroundListeners) {
          try {
            await listener(coords);
          } catch (err) {
            logger.error('BackgroundLocation', 'Listener failed in background task', err);
          }
        }
      }
    },
  );
} catch (e) {
  logger.warn('BackgroundLocation', 'Could not define TaskManager task');
}

export async function isBackgroundLocationActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

export interface StartBackgroundTrackingOptions {
  distanceIntervalMeters?: number;
  timeIntervalMs?: number;
}

export async function startBackgroundLocation(
  options: StartBackgroundTrackingOptions = {},
): Promise<boolean> {
  const permissions = await checkLocationPermissions();
  if (!permissions.backgroundGranted) {
    logger.warn('BackgroundLocation', 'Cannot start background tracking: background permission not granted');
    return false;
  }

  try {
    const isStarted = await Location.hasStartedLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
    if (isStarted) {
      return true;
    }

    const {
      distanceIntervalMeters = 15,
      timeIntervalMs = 10000,
    } = options;

    await Location.startLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: timeIntervalMs,
      distanceInterval: distanceIntervalMeters,
      deferredUpdatesInterval: timeIntervalMs,
      deferredUpdatesDistance: distanceIntervalMeters,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'MyPet Captain Delivery',
        notificationBody: 'Location tracking is active for deliveries.',
        notificationColor: '#1A56DB',
      },
    });

    logger.info('BackgroundLocation', 'Started background location tracking');
    return true;
  } catch (error) {
    logger.error('BackgroundLocation', 'Failed to start background location tracking', error);
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
      logger.info('BackgroundLocation', 'Stopped background location tracking');
    }
  } catch (error) {
    logger.warn('BackgroundLocation', 'Failed to stop background location tracking');
  }
}
