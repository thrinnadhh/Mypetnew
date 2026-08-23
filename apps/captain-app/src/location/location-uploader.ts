import { updateCaptainAvailability } from '../api/availability';
import { calculateDistanceMeters } from '../domain/location-state';
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

export class LocationUploader {
  private intervalId: any = null;
  private lastCoordinates: Coordinates | null = null;
  private lastUploadedCoords: Coordinates | null = null;
  private lastUploadedAt = 0;
  private isOnline = false;
  private hasActiveDelivery = false;
  private unsubscribeBackground: (() => void) | null = null;

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
      logger.debug(
        'LocationUploader',
        `Publishing coordinate update: ${sanitizeCoordinates(coords.latitude, coords.longitude)} (online: ${isOnline}, active: ${this.hasActiveDelivery})`,
      );

      await updateCaptainAvailability({
        online: isOnline,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        capturedAt: new Date(coords.timestamp).toISOString(),
        heading: coords.heading,
        speed: coords.speed,
      });

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
    try {
      const coords = await getCurrentCaptainLocation({ maxAgeMs: 45000 });
      await this.uploadCoordinates(coords, isOnline, force);
      return coords;
    } catch (error) {
      logger.warn('LocationUploader', 'Unable to acquire location for periodic publish');
      return null;
    }
  }

  /**
   * Starts periodic foreground polling and attaches background listeners.
   */
  startTracking(isOnline: boolean, hasActiveDelivery = false): void {
    this.stopTracking();
    this.isOnline = isOnline;
    this.hasActiveDelivery = hasActiveDelivery;

    if (!isOnline && !hasActiveDelivery) {
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

    // Listen to background updates if enabled
    this.unsubscribeBackground = addBackgroundLocationListener(async (coords) => {
      if (this.isOnline || this.hasActiveDelivery) {
        await this.uploadCoordinates(coords, this.isOnline);
      }
    });

    if (hasActiveDelivery) {
      startBackgroundLocation({
        distanceIntervalMeters: this.config.activeDistanceMeters,
        timeIntervalMs: this.config.activeTimeIntervalMs,
      }).catch(() => {});
    }
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
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.unsubscribeBackground) {
      this.unsubscribeBackground();
      this.unsubscribeBackground = null;
    }
    stopBackgroundLocation().catch(() => {});
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
