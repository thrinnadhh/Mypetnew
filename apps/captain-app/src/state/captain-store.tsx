import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '../auth/context';
import { getAuthGeneration, getRuntimeAccountId } from '../auth/session';
import {
  CaptainPresence,
  CaptainProfile,
  CaptainState,
  computeCaptainState,
} from '../domain/captain';
import {
  AvailabilityState,
  CaptainLocationActivityState,
  LocationPermissionState,
} from '../domain/location-state';
import { AppError } from '../domain/result';
import { getCurrentCaptainLocation } from '../location/foreground-location';
import { locationUploader } from '../location/location-uploader';
import {
  checkLocationPermissions,
  LocationPermissionStatus,
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
} from '../location/permissions';
import { availabilityRepository } from '../repositories/availability-repository';
import { connectivity } from '../sync/connectivity';
import { logger } from '../utils/privacy';

export interface CaptainStoreContextType {
  state: CaptainState;
  availabilityState: AvailabilityState;
  locationPermissionState: LocationPermissionState;
  locationActivityState: CaptainLocationActivityState;
  profile: CaptainProfile | null;
  presence: CaptainPresence;
  isOnline: boolean;
  isUpdatingPresence: boolean;
  presenceError: AppError | null;
  isNetworkConnected: boolean;
  setOnline: (online: boolean) => Promise<boolean>;
  refreshPresence: () => Promise<void>;
  checkPermissions: () => Promise<LocationPermissionStatus>;
  requestForegroundPermission: () => Promise<LocationPermissionStatus>;
  requestBackgroundPermission: () => Promise<LocationPermissionStatus>;
  dismissPresenceError: () => void;
}

const CaptainStoreContext = createContext<CaptainStoreContextType | null>(null);

export const CaptainStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, isAuthenticated, captainProfile } = useAuth();
  const [profileOverride, setProfileOverride] = useState<Partial<CaptainProfile> | null>(null);
  const [presence, setPresence] = useState<CaptainPresence>({ online: false });
  const [availabilityState, setAvailabilityState] = useState<AvailabilityState>('OFFLINE');
  const [locationPermissionState, setLocationPermissionState] =
    useState<LocationPermissionState>('UNKNOWN');
  const [locationActivityState, setLocationActivityState] =
    useState<CaptainLocationActivityState>('STOPPED');
  const [isUpdatingPresence, setIsUpdatingPresence] = useState(false);
  const [presenceError, setPresenceError] = useState<AppError | null>(null);
  const [isNetworkConnected, setIsNetworkConnected] = useState(() => connectivity.online);
  const presenceMutationPending = useRef(false);

  // Synchronize network connectivity listener
  useEffect(() => {
    return connectivity.subscribe((connected) => {
      setIsNetworkConnected(connected);
    });
  }, []);

  // Check initial permissions
  const refreshPermissions = useCallback(async (): Promise<LocationPermissionStatus> => {
    const status = await checkLocationPermissions();
    setLocationPermissionState(status.state);
    return status;
  }, []);

  useEffect(() => {
    let mounted = true;
    checkLocationPermissions().then((status) => {
      if (mounted) {
        setLocationPermissionState(status.state);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const profile = useMemo<CaptainProfile | null>(() => {
    if (!session || session.role !== 'CAPTAIN' || !captainProfile) return null;
    return profileOverride ? { ...captainProfile, ...profileOverride } : captainProfile;
  }, [session, captainProfile, profileOverride]);

  // Reconcile restart/account-switch state from the authenticated server profile.
  useEffect(() => {
    let cancelled = false;
    presenceMutationPending.current = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setProfileOverride(null);
      if (!session || !captainProfile) {
        setPresence({ online: false });
        setAvailabilityState('OFFLINE');
        setLocationActivityState('STOPPED');
        return;
      }
      setPresence({
        online: captainProfile.online,
        lastUpdated: undefined,
      });
      setAvailabilityState(
        captainProfile.busy ? 'BUSY' : captainProfile.online ? 'ONLINE' : 'OFFLINE',
      );
    });

    if (!session || !captainProfile) {
      locationUploader.stopTracking();
    } else if (captainProfile.online || captainProfile.busy) {
      locationUploader.startTracking(captainProfile.online, captainProfile.busy);
    } else {
      locationUploader.stopTracking();
    }
    return () => {
      cancelled = true;
    };
  }, [session?.accountId, captainProfile]);

  // AppState listener for background / foreground transitions
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      logger.debug('CaptainStore', `AppState changed to: ${nextAppState}`);
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (presence.online || profile?.busy) {
          if (locationPermissionState === 'BACKGROUND_ALLOWED') {
            setLocationActivityState('BACKGROUND_TRACKING');
          } else {
            setLocationActivityState('DEGRADED');
          }
        }
      } else if (nextAppState === 'active') {
        refreshPermissions();
        if (presence.online || profile?.busy) {
          setLocationActivityState('FOREGROUND_TRACKING');
          locationUploader.publishCurrentLocation(presence.online).catch(() => {});
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [presence.online, profile?.busy, locationPermissionState, refreshPermissions]);

  const setOnline = useCallback(
    async (targetOnline: boolean): Promise<boolean> => {
      if (presenceMutationPending.current) return false;
      if (presence.online === targetOnline && !profile?.busy) return true;
      if (!targetOnline && profile?.busy) {
        setPresenceError(AppError.fromHttp(409, {
          code: 'CAPTAIN_ACTIVE_DELIVERY',
          message: 'Complete the active delivery before going offline.',
        }));
        setAvailabilityState('BUSY');
        return false;
      }

      const capturedAccountId = getRuntimeAccountId();
      const capturedGeneration = getAuthGeneration();
      const sessionIsCurrent = () =>
        !!capturedAccountId &&
        getRuntimeAccountId() === capturedAccountId &&
        getAuthGeneration() === capturedGeneration;

      presenceMutationPending.current = true;
      setIsUpdatingPresence(true);
      setPresenceError(null);

      // --- 1. GOING ONLINE ---
      if (targetOnline) {
        // A. Verify approved Captain status
        if (!profile?.approved || profile.status !== 'ACTIVE') {
          setIsUpdatingPresence(false);
          presenceMutationPending.current = false;
          const err = AppError.fromHttp(403, {
            code: 'CAPTAIN_NOT_APPROVED',
            message: 'Captain account must be approved before going online.',
          });
          setPresenceError(err);
          setAvailabilityState('OFFLINE');
          return false;
        }

        setAvailabilityState('GOING_ONLINE');

        // B. Verify foreground location permission
        const perm = await checkLocationPermissions();
        if (!perm.foregroundGranted) {
          const requested = await requestForegroundLocationPermission();
          setLocationPermissionState(requested.state);
          if (!requested.foregroundGranted) {
            setIsUpdatingPresence(false);
            presenceMutationPending.current = false;
            const err = AppError.fromHttp(403, {
              code: 'CAPTAIN_LOCATION_REQUIRED',
              message: 'Foreground location permission is required to operate as Captain.',
            });
            setPresenceError(err);
            setAvailabilityState('OFFLINE');
            return false;
          }
        } else {
          setLocationPermissionState(perm.state);
        }

        // C. Acquire sufficiently fresh & accurate GPS coordinate
        let coords;
        try {
          coords = await getCurrentCaptainLocation({ maxAgeMs: 45000 });
        } catch (err: any) {
          setIsUpdatingPresence(false);
          presenceMutationPending.current = false;
          setLocationActivityState('ERROR');
          const error =
            err instanceof AppError ? err : AppError.fromHttp(400, { message: err.message });
          setPresenceError(error);
          setAvailabilityState('OFFLINE');
          return false;
        }

        // D. Submit server availability command
        let outcome: Awaited<ReturnType<typeof availabilityRepository.updateAvailability>>;
        try {
          outcome = await availabilityRepository.updateAvailability({
            online: true,
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            capturedAt: new Date(coords.timestamp).toISOString(),
            heading: coords.heading,
            speed: coords.speed,
          });
        } catch (error) {
          presenceMutationPending.current = false;
          setIsUpdatingPresence(false);
          setAvailabilityState('OFFLINE');
          setPresenceError(
            error instanceof AppError ? error : AppError.network('Unable to update availability'),
          );
          return false;
        }

        if (!sessionIsCurrent()) {
          presenceMutationPending.current = false;
          return false;
        }

        setIsUpdatingPresence(false);
        presenceMutationPending.current = false;

        // E. Authoritative Server Acknowledgment
        if (outcome.outcome === 'ACKNOWLEDGED') {
          setPresence({
            online: outcome.data.online,
            latitude: coords.latitude,
            longitude: coords.longitude,
            lastUpdated: outcome.data.lastLocationAt || new Date().toISOString(),
          });
          setProfileOverride({ online: outcome.data.online, approved: outcome.data.approved });
          setAvailabilityState(profile.busy ? 'BUSY' : 'ONLINE');
          setLocationActivityState('FOREGROUND_TRACKING');

          locationUploader.startTracking(true, profile.busy);
          return true;
        }

        // F. Handle Server Rejection or Network Drop
        setAvailabilityState('OFFLINE');
        setLocationActivityState('STOPPED');
        if (outcome.outcome === 'REJECTED') {
          setPresenceError(outcome.error);
        } else if ('error' in outcome && outcome.error) {
          setPresenceError(outcome.error);
        }
        return false;
      }

      // --- 2. GOING OFFLINE ---
      setAvailabilityState('GOING_OFFLINE');

      let outcome: Awaited<ReturnType<typeof availabilityRepository.updateAvailability>>;
      try {
        outcome = await availabilityRepository.updateAvailability({ online: false });
      } catch (error) {
        presenceMutationPending.current = false;
        setIsUpdatingPresence(false);
        setAvailabilityState(profile?.busy ? 'BUSY' : presence.online ? 'ONLINE' : 'OFFLINE');
        setPresenceError(
          error instanceof AppError ? error : AppError.network('Unable to update availability'),
        );
        return false;
      }

      if (!sessionIsCurrent()) {
        presenceMutationPending.current = false;
        return false;
      }

      setIsUpdatingPresence(false);
      presenceMutationPending.current = false;

      if (outcome.outcome === 'ACKNOWLEDGED') {
        locationUploader.stopTracking();
        setLocationActivityState('STOPPED');
        setPresence({
          online: false,
        });
        setProfileOverride({ online: false });
        setAvailabilityState('OFFLINE');
        return true;
      }

      // Preserve server-consistent tracking posture when the offline outcome is unknown/rejected.
      setAvailabilityState(profile?.busy ? 'BUSY' : presence.online ? 'ONLINE' : 'OFFLINE');
      if (outcome.outcome === 'REJECTED') {
        setPresenceError(outcome.error);
      } else if ('error' in outcome && outcome.error) {
        setPresenceError(outcome.error);
      }
      return false;
    },
    [profile, presence.online],
  );

  const refreshPresence = useCallback(async () => {
    if (presence.online || profile?.busy) {
      await locationUploader.publishCurrentLocation(presence.online);
    }
  }, [presence.online, profile?.busy]);

  const requestForeground = useCallback(async () => {
    const status = await requestForegroundLocationPermission();
    setLocationPermissionState(status.state);
    return status;
  }, []);

  const requestBackground = useCallback(async () => {
    const status = await requestBackgroundLocationPermission();
    setLocationPermissionState(status.state);
    return status;
  }, []);

  const dismissPresenceError = useCallback(() => {
    setPresenceError(null);
  }, []);

  const captainDomainState = useMemo(() => {
    return computeCaptainState(isAuthenticated, profile, profile?.busy ?? false);
  }, [isAuthenticated, profile]);

  const value = useMemo<CaptainStoreContextType>(
    () => ({
      state: captainDomainState,
      availabilityState,
      locationPermissionState,
      locationActivityState,
      profile,
      presence,
      isOnline: presence.online,
      isUpdatingPresence,
      presenceError,
      isNetworkConnected,
      setOnline,
      refreshPresence,
      checkPermissions: refreshPermissions,
      requestForegroundPermission: requestForeground,
      requestBackgroundPermission: requestBackground,
      dismissPresenceError,
    }),
    [
      captainDomainState,
      availabilityState,
      locationPermissionState,
      locationActivityState,
      profile,
      presence,
      isUpdatingPresence,
      presenceError,
      isNetworkConnected,
      setOnline,
      refreshPresence,
      refreshPermissions,
      requestForeground,
      requestBackground,
      dismissPresenceError,
    ],
  );

  return <CaptainStoreContext.Provider value={value}>{children}</CaptainStoreContext.Provider>;
};

export function useCaptainStore(): CaptainStoreContextType {
  const context = useContext(CaptainStoreContext);
  if (!context) {
    throw new Error('useCaptainStore must be used within CaptainStoreProvider');
  }
  return context;
}