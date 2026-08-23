import { updateCaptainAvailability } from '../api/availability';
import { Coordinates, getCurrentCaptainLocation } from './foreground-location';

class LocationUploader {
  private intervalId: any = null;
  private lastCoordinates: Coordinates | null = null;
  private minIntervalMs = 15000;
  private lastUploadedAt = 0;

  async publishCurrentLocation(isOnline: boolean): Promise<Coordinates | null> {
    try {
      const coords = await getCurrentCaptainLocation();
      const now = Date.now();

      if (now - this.lastUploadedAt >= this.minIntervalMs) {
        await updateCaptainAvailability({
          online: isOnline,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        this.lastUploadedAt = now;
        this.lastCoordinates = coords;
      }
      return coords;
    } catch {
      return null;
    }
  }

  startPeriodicPublishing(isOnline: boolean, intervalMs = 20000): void {
    this.stopPeriodicPublishing();
    this.publishCurrentLocation(isOnline);
    this.intervalId = setInterval(() => {
      this.publishCurrentLocation(isOnline);
    }, intervalMs);
  }

  stopPeriodicPublishing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getLastKnownCoordinates(): Coordinates | null {
    return this.lastCoordinates;
  }
}

export const locationUploader = new LocationUploader();
