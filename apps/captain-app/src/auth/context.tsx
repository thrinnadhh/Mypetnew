import React, { createContext, useContext, useEffect, useState } from 'react';
import { updateCaptainAvailability } from '../api/availability';
import { fetchCaptainProfile } from '../api/captain';
import { stopBackgroundLocation } from '../location/background-location';
import { locationUploader } from '../location/location-uploader';
import { clearSession, getStoredRefreshState, refreshCaptainSession } from './session';
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
    try {
      const profile = await fetchCaptainProfile();
      setCaptainProfile(profile);
      return profile;
    } catch {
      return null;
    }
  };

  const loginSession = async (newSession: CaptainSessionEnvelope) => {
    setSession(newSession);
    await refreshProfile();
  };

  const logout = async () => {
    try {
      locationUploader.clearCache();
      await stopBackgroundLocation().catch(() => {});
      if (captainProfile?.online) {
        await updateCaptainAvailability({ online: false }).catch(() => {});
      }
    } finally {
      await clearSession();
      setSession(null);
      setCaptainProfile(null);
    }
  };

  const setProfileOnlineState = (online: boolean) => {
    if (captainProfile) {
      setCaptainProfile({ ...captainProfile, online });
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function restore() {
      try {
        const stored = await getStoredRefreshState();
        if (stored) {
          const freshSession = await refreshCaptainSession();
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
