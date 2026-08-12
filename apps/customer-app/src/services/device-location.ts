import * as Location from 'expo-location';

import type { ActiveCity } from '@/context/LocationContext';

export interface DeviceCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export class DeviceLocationError extends Error {
  constructor(
    public readonly code:
      | 'PERMISSION_DENIED'
      | 'POSITION_UNAVAILABLE'
      | 'OUTSIDE_SERVICE_AREA',
    message: string,
  ) {
    super(message);
  }
}

export function distanceKm(
  first: Pick<DeviceCoordinates, 'latitude' | 'longitude'>,
  second: Pick<DeviceCoordinates, 'latitude' | 'longitude'>,
): number {
  const earthRadiusKm = 6371;
  const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function nearestEnabledCity(
  coordinates: DeviceCoordinates,
  enabledCities: ActiveCity[],
): { city: ActiveCity; distanceKm: number } | null {
  const candidates = enabledCities
    .map((city) => ({
      city,
      distanceKm: distanceKm(coordinates, {
        latitude: city.centerLatitude,
        longitude: city.centerLongitude,
      }),
    }))
    .filter(({ city, distanceKm: candidateDistance }) =>
      candidateDistance <= city.radiusKm,
    )
    .sort((left, right) => left.distanceKm - right.distanceKm);

  return candidates[0] ?? null;
}

export async function requestCurrentCoordinates(): Promise<DeviceCoordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new DeviceLocationError(
      'PERMISSION_DENIED',
      permission.canAskAgain
        ? 'Location permission is required to detect your service city.'
        : 'Location permission is disabled. Enable it in system settings or select a city manually.',
    );
  }

  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 2 * 60 * 1000,
    requiredAccuracy: 5000,
  });
  const position =
    lastKnown ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }));

  if (!position?.coords) {
    throw new DeviceLocationError(
      'POSITION_UNAVAILABLE',
      'Your current position could not be determined. Select a city manually.',
    );
  }

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}
