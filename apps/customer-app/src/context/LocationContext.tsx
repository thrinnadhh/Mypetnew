import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import {
  DeviceLocationError,
  nearestEnabledCity,
  requestCurrentCoordinates,
} from '@/services/device-location';
import { appConfig } from '@/utils/app-config';

export interface ServiceRegionFeatureFlags {
  allowProducts: boolean;
  allowGrooming: boolean;
  allowVet: boolean;
  allowOwnDelivery: boolean;
  allow3pDelivery: boolean;
  allowCod: boolean;
  allowOnlinePayment: boolean;
}

export interface ActiveCity {
  id: string;
  cityIdentity: string;
  displayName: string;
  state: string;
  country: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  pincodes: string[];
  featureFlags: ServiceRegionFeatureFlags;
}

export const DEFAULT_TIRUPATI_REGION: ActiveCity = {
  id: '81111111-1111-1111-1111-111111111111',
  cityIdentity: 'tirupati',
  displayName: 'Tirupati',
  state: 'Andhra Pradesh',
  country: 'India',
  centerLatitude: 13.6288,
  centerLongitude: 79.4192,
  radiusKm: 25.0,
  pincodes: ['517501', '517502', '517507'],
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

interface LocationContextType {
  activeCity: ActiveCity;
  enabledCities: ActiveCity[];
  isLocationModalOpen: boolean;
  isNotifyModalOpen: boolean;
  requestedUnavailableCity: string | null;
  loading: boolean;
  locating: boolean;
  openLocationModal: () => void;
  closeLocationModal: () => void;
  closeNotifyModal: () => void;
  selectCity: (city: ActiveCity) => Promise<void>;
  selectCurrentLocation: () => Promise<void>;
  requestUnavailableCityLaunch: (cityName: string) => void;
  submitCityNotificationRequest: (contactInfo: string) => Promise<void>;
  refreshCities: () => Promise<void>;
}

const LocationContext = createContext<LocationContextType | null>(null);
const STORAGE_KEY = 'mypet_active_city_v1';

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `Launch request failed (${response.status})`);
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [activeCity, setActiveCity] = useState<ActiveCity>(DEFAULT_TIRUPATI_REGION);
  const [enabledCities, setEnabledCities] = useState<ActiveCity[]>([DEFAULT_TIRUPATI_REGION]);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false);
  const [requestedUnavailableCity, setRequestedUnavailableCity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);

  const fetchActiveCities = useCallback(async (): Promise<ActiveCity[]> => {
    try {
      const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/service-regions/active`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as ActiveCity[];
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (error) {
      console.warn('Failed to fetch active service regions', error);
    }
    return [DEFAULT_TIRUPATI_REGION];
  }, []);

  const persistCity = useCallback(async (city: ActiveCity) => {
    setActiveCity(city);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(city));
  }, []);

  const refreshCities = useCallback(async () => {
    setLoading(true);
    try {
      const cities = await fetchActiveCities();
      setEnabledCities(cities);
      setActiveCity((current) =>
        cities.find((city) => city.cityIdentity === current.cityIdentity) ??
        cities[0] ??
        DEFAULT_TIRUPATI_REGION,
      );
    } finally {
      setLoading(false);
    }
  }, [fetchActiveCities]);

  useEffect(() => {
    let active = true;

    const initLocation = async () => {
      const cities = await fetchActiveCities();
      if (!active) return;
      setEnabledCities(cities);

      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active) return;
        if (stored) {
          const parsed = JSON.parse(stored) as ActiveCity;
          const matched = cities.find((city) => city.cityIdentity === parsed.cityIdentity);
          setActiveCity(matched ?? cities[0] ?? DEFAULT_TIRUPATI_REGION);
        } else {
          setActiveCity(cities[0] ?? DEFAULT_TIRUPATI_REGION);
        }
      } catch (error) {
        console.warn('Error reading stored active city', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void initLocation();
    return () => {
      active = false;
    };
  }, [fetchActiveCities]);

  const selectCity = useCallback(async (city: ActiveCity) => {
    try {
      await persistCity(city);
      setIsLocationModalOpen(false);
    } catch (error) {
      console.warn('Error persisting active city', error);
      Alert.alert('Location not saved', 'Select the city again.');
    }
  }, [persistCity]);

  const selectCurrentLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      const coordinates = await requestCurrentCoordinates();
      const match = nearestEnabledCity(coordinates, enabledCities);
      if (!match) {
        throw new DeviceLocationError(
          'OUTSIDE_SERVICE_AREA',
          'MyPet is not active at your current location yet. Search for your city to request a launch notification.',
        );
      }
      await persistCity(match.city);
      setIsLocationModalOpen(false);
      Alert.alert(
        'Location selected',
        `${match.city.displayName} is ${match.distanceKm.toFixed(1)} km from your current position.`,
      );
    } catch (error) {
      Alert.alert(
        error instanceof DeviceLocationError && error.code === 'OUTSIDE_SERVICE_AREA'
          ? 'Outside service area'
          : 'Current location unavailable',
        error instanceof Error ? error.message : 'Select a city manually.',
      );
    } finally {
      setLocating(false);
    }
  }, [enabledCities, locating, persistCity]);

  const openLocationModal = useCallback(() => setIsLocationModalOpen(true), []);
  const closeLocationModal = useCallback(() => setIsLocationModalOpen(false), []);
  const closeNotifyModal = useCallback(() => {
    setIsNotifyModalOpen(false);
    setRequestedUnavailableCity(null);
  }, []);

  const requestUnavailableCityLaunch = useCallback((cityName: string) => {
    const normalizedCity = cityName.trim();
    if (!normalizedCity) return;
    setRequestedUnavailableCity(normalizedCity);
    setIsLocationModalOpen(false);
    setIsNotifyModalOpen(true);
  }, []);

  const submitCityNotificationRequest = useCallback(async (contactInfo: string) => {
    const cityName = requestedUnavailableCity?.trim();
    const contact = contactInfo.trim();
    if (!cityName || !contact) {
      Alert.alert('Details required', 'Enter a city and a valid email address or mobile number.');
      return;
    }

    try {
      const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/service-regions/launch-requests`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityName, contactInfo: contact }),
      });
      if (!response.ok) throw await responseError(response);
      const result = (await response.json()) as { status?: string };
      Alert.alert(
        result.status === 'ALREADY_REGISTERED' ? 'Already registered' : 'Request saved',
        `MyPet will notify ${contact} when ${cityName} becomes available.`,
      );
      setIsNotifyModalOpen(false);
      setRequestedUnavailableCity(null);
    } catch (error) {
      Alert.alert(
        'Request not saved',
        error instanceof Error ? error.message : 'Could not save your launch notification request.',
      );
    }
  }, [requestedUnavailableCity]);

  return (
    <LocationContext.Provider
      value={{
        activeCity,
        enabledCities,
        isLocationModalOpen,
        isNotifyModalOpen,
        requestedUnavailableCity,
        loading,
        locating,
        openLocationModal,
        closeLocationModal,
        closeNotifyModal,
        selectCity,
        selectCurrentLocation,
        requestUnavailableCityLaunch,
        submitCityNotificationRequest,
        refreshCities,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useLocation must be used within LocationProvider');
  return context;
}
