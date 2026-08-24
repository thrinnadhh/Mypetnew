import React, { createContext, useContext, useEffect, useState } from 'react';
import { updateCaptainAvailability } from '../api/availability';
import { revokeCurrentCaptainSession } from '../api/auth';
import { fetchCaptainProfile } from '../api/captain';
import { revokeCaptainDevice } from '../api/devices';
import { stopBackgroundLocation } from '../location/background-location';
import { locationUploader } from '../location/location-uploader';
import { commandStore } from '../sync/command-store';
import {
  clearSession,
  getAuthGeneration,
  getInstallationDeviceId,
  getRuntimeAccountId,
  getStoredRefreshState,
  refreshCaptainSession,
} from './session';
import { CaptainApprovalStatus, CaptainProfile, CaptainSessionEnvelope } from './types';

export interface AuthContextValue {
  session: CaptainSessionEnvelope | null;
  captainProfile: CaptainProfile | null;
  status: CaptainApprovalStatus | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  loginSession: (session: CaptainSessionEnvelope) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<CaptainProfile | null>;
  setProfileOnlineState: (online: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<CaptainSessionEnvelope | null>(null);
  const [captainProfile, setCaptainProfile] = useState<CaptainProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(true);

  const refreshProfile = async (): Promise<CaptainProfile | null> => {
    const accountId = getRuntimeAccountId();
    const generation = getAuthGeneration();
    if (!accountId) return null;

    try {
      const profile = await fetchCaptainProfile();
      if (getRuntimeAccountId() !== accountId || getAuthGeneration() !== generation) {
        return null;
      }
      setCaptainProfile(profile);
      return profile;
    } catch {
      return null;
    }
  };

  const loginSession = async (newSession: CaptainSessionEnvelope) => {
    await commandStore.clear();
    setSession(newSession);
    await refreshProfile();
  };

  const logout = async () => {
    locationUploader.clearCache();

    // Dispatch best-effort authenticated cleanup before invalidating local credentials.
    // The transport's generation guard intentionally rejects their late client responses.
    const serverRevocation = revokeCurrentCaptainSession().catch(() => {});
    const deviceRevocation = revokeCaptainDevice().catch(() => {});
    const availabilityCleanup =
      captainProfile?.online && !captainProfile.busy
        ? updateCaptainAvailability({ online: false }).catch(() => {})
        : Promise.resolve();
    const backgroundCleanup = stopBackgroundLocation().catch(() => {});

    await clearSession();
    setSession(null);
    setCaptainProfile(null);

    await Promise.allSettled([
      serverRevocation,
      deviceRevocation,
      availabilityCleanup,
      backgroundCleanup,
      commandStore.clear(),
    ]);
  };

  const setProfileOnlineState = (online: boolean) => {
    setCaptainProfile((current) => (current ? { ...current, online } : null));
  };

  useEffect(() => {
    let isMounted = true;

    async function restore() {
      try {
        const stored = await getStoredRefreshState();
        if (stored) {
          const freshSession = await refreshCaptainSession();
          // Prime the synchronous logout-revocation identity before rendering an
          // authenticated tree. OTP login already performs the same initialization.
          await getInstallationDeviceId();
          if (isMounted) {
            setSession(freshSession);
            await refreshProfile();
          }
        }
      } catch {
        if (isMounted) {
          setSession(null);
          setCaptainProfile(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRestoring(false);
        }
      }
    }

    restore();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        captainProfile,
        status: captainProfile?.status || null,
        isAuthenticated: !!session,
        isLoading,
        isRestoring,
        loginSession,
        logout,
        refreshProfile,
        setProfileOnlineState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
