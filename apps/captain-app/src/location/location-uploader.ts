import { publishCaptainLocation } from '../api/availability';
import { getAuthGeneration, getRuntimeAccountId } from '../auth/session';
import {
  calculateDistanceMeters,
  isCoordinateFresh,
  isValidCoordinate,
} from '../domain/location-state';
import { logger, sanitizeCoordinates } from '../utils/privacy';
import {
  addBackgroundLocationListener,
  startBackgroundLocation,
  stopBackgroundLocation,
} from './background-location';
import { Coordinates, getCurrentCaptainLocation } from './foreground-location';

export interface LocationUploaderConfig {
  idleTimeIntervalMs?: number;
  idleDistanceMeters?: number;
  activeTimeIntervalMs?: number;
  activeDistanceMeters?: number;
  minBurstIntervalMs?: number;
}

const MAX_UPLOAD_ACCURACY_METERS = 200;

export class LocationUploader {
  private intervalId: any = null;
  private lastCoordinates: Coordinates | null = null;
  private lastUploadedCoords: Coordinates | null = null;
  private lastUploadedAt = 0;
  private isOnline = false;
  private hasActiveDelivery = false;
  private unsubscribeBackground: (() => void) | null = null;
  private trackingRevision = 0;
  private backgroundOperation: Promise<void> = Promise.resolve();
  private publishInFlight: Promise<Coordinates | null> | null = null;

  private config: Required<LocationUploaderConfig>;

  constructor(config: LocationUploaderConfig = {}) {
    this.config = {
      idleTimeIntervalMs: config.idleTimeIntervalMs ?? 25000,
      idleDistanceMeters: config.idleDistanceMeters ?? 25,
      activeTimeIntervalMs: config.activeTimeIntervalMs ?? 10000,
      activeDistanceMeters: config.activeDistanceMeters ?? 15,
      minBurstIntervalMs: config.minBurstIntervalMs ?? 4000,
    };
  }

  /**
   * Evaluates if coordinates should be uploaded based on time, displacement, and delivery state.
   */
  shouldUpload(
    coords: Coordinates,
    now = Date.now(),
    hasActiveDelivery = this.hasActiveDelivery,
  ): boolean {
    if (!this.lastUploadedCoords) {
      return true;
    }

    const elapsedMs = now - this.lastUploadedAt;
    if (elapsedMs < this.config.minBurstIntervalMs) {
      return false;
    }

    const maxInterval = hasActiveDelivery
      ? this.config.activeTimeIntervalMs
      : this.config.idleTimeIntervalMs;

    if (elapsedMs >= maxInterval) {
      return true;
    }

    const minDistance = hasActiveDelivery
      ? this.config.activeDistanceMeters
      : this.config.idleDistanceMeters;

    const distanceMoved = calculateDistanceMeters(
      this.lastUploadedCoords.latitude,
      this.lastUploadedCoords.longitude,
      coords.latitude,
      coords.longitude,
    );

    return distanceMoved >= minDistance;
  }

  /**
   * Uploads given coordinates if throttling permits or force = true.
   */
  async uploadCoordinates(
    coords: Coordinates,
    isOnline: boolean,
    force = false,
  ): Promise<boolean> {
    if (
      !isValidCoordinate(coords.latitude, coords.longitude) ||
      !isCoordinateFresh(coords.timestamp, 120_000) ||
      coords.accuracy == null ||
      !Number.isFinite(coords.accuracy) ||
      coords.accuracy < 0 ||
      coords.accuracy > MAX_UPLOAD_ACCURACY_METERS
    ) {
      logger.warn('LocationUploader', 'Rejected invalid or stale coordinate update');
      return false;
    }

    const accountId = getRuntimeAccountId();
    const authGeneration = getAuthGeneration();
    const revision = this.trackingRevision;
    if (!accountId || (!this.isOnline && !this.hasActiveDelivery)) return false;

    this.lastCoordinates = coords;
    const now = Date.now();

    if (!force && !this.shouldUpload(coords, now, this.hasActiveDelivery)) {
      logger.debug(
        'LocationUploader',
        `Throttled coordinate update: ${sanitizeCoordinates(coords.latitude, coords.longitude)}`,
      );
      return false;
    }

    try {
      const reportedOnline = isOnline || this.hasActiveDelivery;
      logger.debug(
        'LocationUploader',
        `Publishing coordinate update: ${sanitizeCoordinates(coords.latitude, coords.longitude)} (online: ${reportedOnline}, active: ${this.hasActiveDelivery})`,
      );

      await publishCaptainLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        capturedAt: new Date(coords.timestamp).toISOString(),
        heading: coords.heading,
        speed: coords.speed,
      });

      if (
        getRuntimeAccountId() !== accountId ||
        getAuthGeneration() !== authGeneration ||
        this.trackingRevision !== revision
      ) {
        return false;
      }

      this.lastUploadedAt = now;
      this.lastUploadedCoords = coords;
      return true;
    } catch (error) {
      logger.error('LocationUploader', 'Failed to publish location to server', error);
      return false;
    }
  }

  /**
   * Fetches fresh foreground coordinates and uploads if eligible.
   */
  async publishCurrentLocation(
    isOnline: boolean,
    force = false,
  ): Promise<Coordinates | null> {
    if (this.publishInFlight) return this.publishInFlight;

    const request = (async () => {
      try {
        const coords = await getCurrentCaptainLocation({ maxAgeMs: 45000 });
        await this.uploadCoordinates(coords, isOnline, force);
        return coords;
      } catch {
        logger.warn('LocationUploader', 'Unable to acquire location for periodic publish');
        return null;
      }
    })();
    this.publishInFlight = request;
    try {
      return await request;
    } finally {
      if (this.publishInFlight === request) this.publishInFlight = null;
    }
  }

  /**
   * Starts periodic foreground polling and attaches background listeners.
   */
  startTracking(isOnline: boolean, hasActiveDelivery = false): void {
    this.clearForegroundTracking();
    this.isOnline = isOnline;
    this.hasActiveDelivery = hasActiveDelivery;

    if (!isOnline && !hasActiveDelivery) {
      this.scheduleBackgroundTracking(false);
      return;
    }

    // Immediately attempt an initial fix
    this.publishCurrentLocation(isOnline, true);

    const pollingInterval = hasActiveDelivery
      ? this.config.activeTimeIntervalMs
      : this.config.idleTimeIntervalMs;

    this.intervalId = setInterval(() => {
      this.publishCurrentLocation(this.isOnline);
    }, pollingInterval);

    // Keep the in-process cache current; the TaskManager handler owns server publishing.
    this.unsubscribeBackground = addBackgroundLocationListener(async (coords) => {
      this.lastCoordinates = coords;
    });

    this.scheduleBackgroundTracking(true);
  }

  /**
   * Updates the active delivery state, adjusting intervals and background tracking.
   */
  setActiveDelivery(hasActiveDelivery: boolean): void {
    if (this.hasActiveDelivery === hasActiveDelivery) return;
    this.hasActiveDelivery = hasActiveDelivery;

    if (this.isOnline || hasActiveDelivery) {
      this.startTracking(this.isOnline, hasActiveDelivery);
    }
  }

  /**
   * Stops foreground timer and background updates.
   */
  stopTracking(): void {
    this.clearForegroundTracking();
    this.isOnline = false;
    this.hasActiveDelivery = false;
    this.scheduleBackgroundTracking(false);
  }

  private clearForegroundTracking(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.unsubscribeBackground) {
      this.unsubscribeBackground();
      this.unsubscribeBackground = null;
    }
  }

  private scheduleBackgroundTracking(shouldTrack: boolean): void {
    const revision = ++this.trackingRevision;
    const accountId = getRuntimeAccountId();
    const online = this.isOnline;
    const activeDelivery = this.hasActiveDelivery;
    this.backgroundOperation = this.backgroundOperation
      .catch(() => {})
      .then(async () => {
        if (revision !== this.trackingRevision) return;
        if (!shouldTrack || !accountId) {
          await stopBackgroundLocation();
          return;
        }
        await startBackgroundLocation({
          accountId,
          online,
          activeDelivery,
          distanceIntervalMeters: activeDelivery
            ? this.config.activeDistanceMeters
            : this.config.idleDistanceMeters,
          timeIntervalMs: activeDelivery
            ? this.config.activeTimeIntervalMs
            : this.config.idleTimeIntervalMs,
        });
      });
  }

  /**
   * Wipes operational coordinates cache on logout or reset.
   */
  clearCache(): void {
    this.stopTracking();
    this.lastCoordinates = null;
    this.lastUploadedCoords = null;
    this.lastUploadedAt = 0;
    this.isOnline = false;
    this.hasActiveDelivery = false;
  }

  getLastKnownCoordinates(): Coordinates | null {
    return this.lastCoordinates;
  }

  getLastUploadedCoordinates(): Coordinates | null {
    return this.lastUploadedCoords;
  }
}

export const locationUploader = new LocationUploader();
