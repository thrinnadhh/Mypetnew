import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/context';
import { CaptainPresence, CaptainProfile, CaptainState, computeCaptainState } from '../domain/captain';
import { AppError } from '../domain/result';
import { getCurrentCaptainLocation } from '../location/foreground-location';
import { locationUploader } from '../location/location-uploader';
import { availabilityRepository } from '../repositories/availability-repository';
import { connectivity } from '../sync/connectivity';

interface CaptainStoreContextType {
  state: CaptainState;
  profile: CaptainProfile | null;
  presence: CaptainPresence;
  isOnline: boolean;
  isUpdatingPresence: boolean;
  presenceError: AppError | null;
  isNetworkConnected: boolean;
  setOnline: (online: boolean) => Promise<boolean>;
  refreshPresence: () => Promise<void>;
}

const CaptainStoreContext = createContext<CaptainStoreContextType | null>(null);

export const CaptainStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, isAuthenticated, captainProfile } = useAuth();
  const [profileOverride, setProfileOverride] = useState<Partial<CaptainProfile> | null>(null);
  const [presence, setPresence] = useState<CaptainPresence>({ online: false });
  const [isUpdatingPresence, setIsUpdatingPresence] = useState(false);
  const [presenceError, setPresenceError] = useState<AppError | null>(null);
  const [isNetworkConnected, setIsNetworkConnected] = useState(() => connectivity.online);

  useEffect(() => {
    return connectivity.subscribe((connected) => {
      setIsNetworkConnected(connected);
    });
  }, []);

  const profile = useMemo<CaptainProfile | null>(() => {
    if (!session || session.role !== 'CAPTAIN') return null;
    const base: CaptainProfile = captainProfile ?? {
      captainId: session.accountId,
      mobile: '',
      status: 'ACTIVE',
      approved: true,
      online: false,
      busy: false,
    };
    return profileOverride ? { ...base, ...profileOverride } : base;
  }, [session, captainProfile, profileOverride]);

  const setOnline = useCallback(async (online: boolean): Promise<boolean> => {
    setIsUpdatingPresence(true);
    setPresenceError(null);

    let latitude: number | undefined;
    let longitude: number | undefined;

    if (online) {
      try {
        const coords = await getCurrentCaptainLocation();
        latitude = coords.latitude;
        longitude = coords.longitude;
      } catch (err: any) {
        setIsUpdatingPresence(false);
        const error = err instanceof AppError ? err : AppError.fromHttp(400, { message: err.message });
        setPresenceError(error);
        return false;
      }
    }

    const outcome = await availabilityRepository.updateAvailability({
      online,
      latitude,
      longitude,
    });

    setIsUpdatingPresence(false);

    if (outcome.outcome === 'ACKNOWLEDGED') {
      setPresence({
        online: outcome.data.online,
        latitude,
        longitude,
        lastUpdated: outcome.data.lastLocationAt || new Date().toISOString(),
      });
      setProfileOverride({ online: outcome.data.online, approved: outcome.data.approved });

      if (outcome.data.online) {
        locationUploader.startPeriodicPublishing(true);
      } else {
        locationUploader.stopPeriodicPublishing();
      }

      return true;
    }

    if (outcome.outcome === 'REJECTED') {
      setPresenceError(outcome.error);
      return false;
    }

    // Outcome is UNKNOWN or PENDING (network lost during presence update)
    if ('error' in outcome && outcome.error) {
      setPresenceError(outcome.error);
    }
    return false;
  }, []);

  const refreshPresence = useCallback(async () => {
    if (presence.online) {
      await locationUploader.publishCurrentLocation(true);
    }
  }, [presence.online]);

  const captainDomainState = useMemo(() => {
    return computeCaptainState(isAuthenticated, profile, profile?.busy ?? false);
  }, [isAuthenticated, profile]);

  const value = useMemo<CaptainStoreContextType>(() => ({
    state: captainDomainState,
    profile,
    presence,
    isOnline: presence.online,
    isUpdatingPresence,
    presenceError,
    isNetworkConnected,
    setOnline,
    refreshPresence,
  }), [captainDomainState, profile, presence, isUpdatingPresence, presenceError, isNetworkConnected, setOnline, refreshPresence]);

  return (
    <CaptainStoreContext.Provider value={value}>
      {children}
    </CaptainStoreContext.Provider>
  );
};

export function useCaptainStore(): CaptainStoreContextType {
  const context = useContext(CaptainStoreContext);
  if (!context) {
    throw new Error('useCaptainStore must be used within CaptainStoreProvider');
  }
  return context;
}
