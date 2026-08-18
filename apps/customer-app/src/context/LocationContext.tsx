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
  selectedPincode: string;
  enabledCities: ActiveCity[];
  serviceRegionError: boolean;
  isLocationModalOpen: boolean;
  isNotifyModalOpen: boolean;
  requestedUnavailableCity: string | null;
  loading: boolean;
  locating: boolean;
  openLocationModal: () => void;
  closeLocationModal: () => void;
  closeNotifyModal: () => void;
  selectCity: (city: ActiveCity, pincode?: string) => Promise<void>;
  selectPincode: (pincode: string) => Promise<void>;
  selectCurrentLocation: () => Promise<void>;
  requestUnavailableCityLaunch: (cityName: string) => void;
  submitCityNotificationRequest: (contactInfo: string) => Promise<void>;
  refreshCities: () => Promise<void>;
}

const LocationContext = createContext<LocationContextType | null>(null);
const STORAGE_KEY = 'mypet_active_city_v1';
const PIN_STORAGE_KEY = 'mypet_selected_pincode_v1';

function normalizeSelectablePincode(city: ActiveCity, pincode?: string | null): string | null {
  const normalized = pincode?.trim() ?? '';
  if (/^[1-9][0-9]{5}$/.test(normalized) && city.pincodes.includes(normalized)) {
    return normalized;
  }
  return city.pincodes.find((value) => /^[1-9][0-9]{5}$/.test(value)) ?? null;
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `Launch request failed (${response.status})`);
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const initialDemoPincode = appConfig.allowDemoMode
    ? normalizeSelectablePincode(DEFAULT_TIRUPATI_REGION) ?? ''
    : '';
  const [activeCity, setActiveCity] = useState<ActiveCity>(DEFAULT_TIRUPATI_REGION);
  const [selectedPincode, setSelectedPincode] = useState(initialDemoPincode);
  const [enabledCities, setEnabledCities] = useState<ActiveCity[]>(
    appConfig.allowDemoMode ? [DEFAULT_TIRUPATI_REGION] : [],
  );
  const [serviceRegionError, setServiceRegionError] = useState(false);
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
      throw new Error('No active service regions were returned.');
    } catch (error) {
      console.warn('Failed to fetch active service regions', error);
      if (appConfig.allowDemoMode) return [DEFAULT_TIRUPATI_REGION];
      throw error;
    }
  }, []);

  const persistCity = useCallback(async (city: ActiveCity, pincode?: string) => {
    const nextPincode = normalizeSelectablePincode(
      city,
      pincode ?? (city.cityIdentity === activeCity.cityIdentity ? selectedPincode : undefined),
    );
    if (!nextPincode) {
      throw new Error('The selected city does not have an active service PIN code.');
    }
    setActiveCity(city);
    setSelectedPincode(nextPincode);
    setServiceRegionError(false);
    await AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(city)],
      [PIN_STORAGE_KEY, nextPincode],
    ]);
  }, [activeCity.cityIdentity, selectedPincode]);

  const refreshCities = useCallback(async () => {
    setLoading(true);
    try {
      const cities = await fetchActiveCities();
      setEnabledCities(cities);
      setServiceRegionError(false);
      const nextCity =
        cities.find((city) => city.cityIdentity === activeCity.cityIdentity)
        ?? cities[0]
        ?? DEFAULT_TIRUPATI_REGION;
      setActiveCity(nextCity);
      setSelectedPincode((current) => normalizeSelectablePincode(nextCity, current) ?? '');
    } catch (error) {
      console.warn('Failed to refresh active service regions', error);
      setEnabledCities([]);
      setSelectedPincode('');
      setServiceRegionError(true);
    } finally {
      setLoading(false);
    }
  }, [activeCity.cityIdentity, fetchActiveCities]);

  useEffect(() => {
    let active = true;

    const initLocation = async () => {
      try {
        const cities = await fetchActiveCities();
        if (!active) return;
        setEnabledCities(cities);
        setServiceRegionError(false);

        const [storedCity, storedPincode] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(PIN_STORAGE_KEY),
        ]);
        if (!active) return;
        const parsed = storedCity ? JSON.parse(storedCity) as ActiveCity : null;
        const matched = parsed
          ? cities.find((city) => city.cityIdentity === parsed.cityIdentity)
          : null;
        const nextCity = matched ?? cities[0] ?? DEFAULT_TIRUPATI_REGION;
        setActiveCity(nextCity);
        setSelectedPincode(normalizeSelectablePincode(nextCity, storedPincode) ?? '');
      } catch (error) {
        console.warn('Unable to initialize live service regions', error);
        if (!active) return;
        if (appConfig.allowDemoMode) {
          setEnabledCities([DEFAULT_TIRUPATI_REGION]);
          setActiveCity(DEFAULT_TIRUPATI_REGION);
          setSelectedPincode(normalizeSelectablePincode(DEFAULT_TIRUPATI_REGION) ?? '');
          setServiceRegionError(false);
        } else {
          setEnabledCities([]);
          setSelectedPincode('');
          setServiceRegionError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void initLocation();
    return () => {
      active = false;
    };
  }, [fetchActiveCities]);

  const selectCity = useCallback(async (city: ActiveCity, pincode?: string) => {
    try {
      await persistCity(city, pincode);
      setIsLocationModalOpen(false);
    } catch (error) {
      console.warn('Error persisting active service location', error);
      Alert.alert('Location not saved', 'Select the city and service PIN again.');
    }
  }, [persistCity]);

  const selectPincode = useCallback(async (pincode: string) => {
    try {
      await persistCity(activeCity, pincode);
      setIsLocationModalOpen(false);
    } catch (error) {
      console.warn('Error persisting service PIN', error);
      Alert.alert('PIN not saved', 'Select an active service PIN again.');
    }
  }, [activeCity, persistCity]);

  const selectCurrentLocation = useCallback(async () => {
    if (locating) return;
    if (serviceRegionError || enabledCities.length === 0) {
      Alert.alert('Service regions unavailable', 'Retry loading live service regions before using current location.');
      return;
    }
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
      const pincode = normalizeSelectablePincode(match.city);
      if (!pincode) {
        throw new DeviceLocationError(
          'OUTSIDE_SERVICE_AREA',
          'This service city has no active PIN code configured.',
        );
      }
      await persistCity(match.city, pincode);
      setIsLocationModalOpen(false);
      Alert.alert(
        'Location selected',
        `${match.city.displayName} · service PIN ${pincode}. You can change the PIN from the location selector.`,
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
  }, [enabledCities, locating, persistCity, serviceRegionError]);

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
        selectedPincode,
        enabledCities,
        serviceRegionError,
        isLocationModalOpen,
        isNotifyModalOpen,
        requestedUnavailableCity,
        loading,
        locating,
        openLocationModal,
        closeLocationModal,
        closeNotifyModal,
        selectCity,
        selectPincode,
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
