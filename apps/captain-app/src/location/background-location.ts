import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { publishCaptainLocation } from '../api/availability';
import { getRuntimeAccountId, getStoredRefreshState } from '../auth/session';
import { isCoordinateFresh, isValidCoordinate } from '../domain/location-state';
import { logger } from '../utils/privacy';
import { Coordinates } from './foreground-location';
import { checkLocationPermissions } from './permissions';

export const CAPTAIN_BACKGROUND_LOCATION_TASK = 'MYPET_CAPTAIN_BACKGROUND_LOCATION';
const BACKGROUND_TRACKING_STATE_KEY = 'mypetnew.captain.background_tracking.v1';
const MAX_BACKGROUND_ACCURACY_METERS = 200;

export type BackgroundLocationListener = (coords: Coordinates) => Promise<void> | void;

type BackgroundTrackingState = {
  version: 1;
  accountId: string;
  online: boolean;
  activeDelivery: boolean;
};

const backgroundListeners: Set<BackgroundLocationListener> = new Set();

export function addBackgroundLocationListener(listener: BackgroundLocationListener): () => void {
  backgroundListeners.add(listener);
  return () => {
    backgroundListeners.delete(listener);
  };
}

async function readTrackingState(): Promise<BackgroundTrackingState | null> {
  try {
    const raw = await SecureStore.getItemAsync(BACKGROUND_TRACKING_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackgroundTrackingState>;
    if (
      parsed.version !== 1 ||
      typeof parsed.accountId !== 'string' ||
      typeof parsed.online !== 'boolean' ||
      typeof parsed.activeDelivery !== 'boolean'
    ) {
      return null;
    }
    return parsed as BackgroundTrackingState;
  } catch {
    return null;
  }
}

async function persistTrackingState(state: BackgroundTrackingState): Promise<void> {
  await SecureStore.setItemAsync(BACKGROUND_TRACKING_STATE_KEY, JSON.stringify(state));
}

function latestValidCoordinates(data: any): Coordinates | null {
  const locations = Array.isArray(data?.locations) ? data.locations : [];
  const rawLocation = locations[locations.length - 1];
  const latitude = rawLocation?.coords?.latitude;
  const longitude = rawLocation?.coords?.longitude;
  const accuracy = rawLocation?.coords?.accuracy;
  const timestamp = rawLocation?.timestamp;

  if (
    !isValidCoordinate(latitude, longitude) ||
    !isCoordinateFresh(timestamp, 120_000) ||
    accuracy == null ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > MAX_BACKGROUND_ACCURACY_METERS
  ) {
    return null;
  }

  const heading = rawLocation.coords.heading;
  const speed = rawLocation.coords.speed;
  return {
    latitude,
    longitude,
    accuracy: accuracy ?? null,
    timestamp,
    heading: Number.isFinite(heading) ? heading : null,
    speed: Number.isFinite(speed) ? speed : null,
  };
}

/**
 * Publishes a TaskManager batch without depending on in-memory React listeners.
 * This is the process-death-safe path used by the native background task.
 */
export async function processBackgroundLocationBatch(data: unknown): Promise<boolean> {
  const state = await readTrackingState();
  if (!state) return false;

  const storedSession = await getStoredRefreshState();
  if (!storedSession || storedSession.accountId !== state.accountId) {
    return false;
  }

  const coordinates = latestValidCoordinates(data);
  if (!coordinates) return false;

  try {
    await publishCaptainLocation({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracy: coordinates.accuracy,
      capturedAt: new Date(coordinates.timestamp).toISOString(),
      heading: coordinates.heading,
      speed: coordinates.speed,
    });

    // The canonical transport validates the refreshed account. This final check protects
    // listener/UI side effects if an account switch raced the network response.
    if (getRuntimeAccountId() !== state.accountId) return false;

    for (const listener of backgroundListeners) {
      try {
        await listener(coordinates);
      } catch {
        logger.warn('BackgroundLocation', 'Background location listener failed');
      }
    }
    return true;
  } catch {
    logger.warn('BackgroundLocation', 'Background location publish failed');
    return false;
  }
}

try {
  TaskManager.defineTask(
    CAPTAIN_BACKGROUND_LOCATION_TASK,
    async ({ data, error }: { data: unknown; error: unknown }) => {
      if (error) {
        logger.warn('BackgroundLocation', 'Native background location task reported an error');
        return;
      }
      await processBackgroundLocationBatch(data);
    },
  );
} catch {
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
  accountId?: string;
  online?: boolean;
  activeDelivery?: boolean;
}

export async function startBackgroundLocation(
  options: StartBackgroundTrackingOptions = {},
): Promise<boolean> {
  const permissions = await checkLocationPermissions();
  if (!permissions.backgroundGranted) {
    logger.warn('BackgroundLocation', 'Cannot start background tracking: permission not granted');
    return false;
  }

  const accountId = options.accountId || getRuntimeAccountId();
  if (!accountId) {
    logger.warn('BackgroundLocation', 'Cannot start background tracking without a Captain session');
    return false;
  }

  try {
    await persistTrackingState({
      version: 1,
      accountId,
      online: options.online ?? true,
      activeDelivery: options.activeDelivery ?? false,
    });

    const isStarted = await Location.hasStartedLocationUpdatesAsync(
      CAPTAIN_BACKGROUND_LOCATION_TASK,
    );
    if (isStarted) return true;

    const { distanceIntervalMeters = 15, timeIntervalMs = 10_000 } = options;
    await Location.startLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: timeIntervalMs,
      distanceInterval: distanceIntervalMeters,
      deferredUpdatesInterval: timeIntervalMs,
      deferredUpdatesDistance: distanceIntervalMeters,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'MyPet Captain Delivery',
        notificationBody: 'Location tracking is active while you are online.',
        notificationColor: '#1A56DB',
      },
    });

    logger.info('BackgroundLocation', 'Started background location tracking');
    return true;
  } catch {
    try {
      await SecureStore.deleteItemAsync(BACKGROUND_TRACKING_STATE_KEY);
    } catch {
      // Best-effort state cleanup after native start failure.
    }
    logger.warn('BackgroundLocation', 'Failed to start background location tracking');
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BACKGROUND_TRACKING_STATE_KEY);
  } catch {
    // Continue stopping the native task even if secure state cleanup fails.
  }
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(CAPTAIN_BACKGROUND_LOCATION_TASK);
      logger.info('BackgroundLocation', 'Stopped background location tracking');
    }
  } catch {
    logger.warn('BackgroundLocation', 'Failed to stop background location tracking');
  }
}
