jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

import * as ExpoLocation from 'expo-location';

import type { ActiveCity } from '@/context/LocationContext';
import {
  DeviceLocationError,
  distanceKm,
  nearestEnabledCity,
  requestCurrentCoordinates,
} from '../device-location';

const mockedLocation = ExpoLocation as jest.Mocked<typeof ExpoLocation>;

const tirupati: ActiveCity = {
  id: '81111111-1111-1111-1111-111111111111',
  cityIdentity: 'tirupati',
  displayName: 'Tirupati',
  state: 'Andhra Pradesh',
  country: 'India',
  centerLatitude: 13.6288,
  centerLongitude: 79.4192,
  radiusKm: 25,
  pincodes: ['517501'],
  featureFlags: {
    allowProducts: true,
    allowGrooming: true,
    allowVet: true,
    allowOwnDelivery: true,
    allow3pDelivery: true,
    allowCod: true,
    allowOnlinePayment: true,
  },
};

const bengaluru: ActiveCity = {
  ...tirupati,
  id: '82222222-2222-4222-8222-222222222222',
  cityIdentity: 'bengaluru',
  displayName: 'Bengaluru',
  state: 'Karnataka',
  centerLatitude: 12.9716,
  centerLongitude: 77.5946,
};

describe('device location', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calculates geographical distance and selects the enabled service city', () => {
    expect(
      distanceKm(
        { latitude: tirupati.centerLatitude, longitude: tirupati.centerLongitude },
        { latitude: tirupati.centerLatitude, longitude: tirupati.centerLongitude },
      ),
    ).toBeCloseTo(0, 5);

    const result = nearestEnabledCity(
      { latitude: 13.63, longitude: 79.42 },
      [bengaluru, tirupati],
    );
    expect(result?.city.cityIdentity).toBe('tirupati');
    expect(result?.distanceKm).toBeLessThan(1);
  });

  it('returns no city outside all configured service radii', () => {
    expect(
      nearestEnabledCity(
        { latitude: 28.6139, longitude: 77.209 },
        [tirupati, bengaluru],
      ),
    ).toBeNull();
  });

  it('rejects denied permission without reading position', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      status: 'denied',
      expires: 'never',
    } as never);

    await expect(requestCurrentCoordinates()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('uses a recent last-known position before polling the device', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
      expires: 'never',
    } as never);
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue({
      coords: {
        latitude: 13.6288,
        longitude: 79.4192,
        altitude: null,
        accuracy: 25,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });

    await expect(requestCurrentCoordinates()).resolves.toMatchObject({
      latitude: 13.6288,
      longitude: 79.4192,
      accuracy: 25,
    });
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('polls current position when no recent coordinate exists', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
      status: 'granted',
      expires: 'never',
    } as never);
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: {
        latitude: 12.9716,
        longitude: 77.5946,
        altitude: null,
        accuracy: 50,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });

    await expect(requestCurrentCoordinates()).resolves.toMatchObject({
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it('exposes typed location errors', () => {
    const error = new DeviceLocationError(
      'OUTSIDE_SERVICE_AREA',
      'Outside service area',
    );
    expect(error.code).toBe('OUTSIDE_SERVICE_AREA');
  });
});
