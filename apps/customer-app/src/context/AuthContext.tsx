import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { isFreshOtp } from '@/auth/fresh-otp';
import { validateServerRole, type OtpSessionResponse } from '@/auth/otp-auth';
import { clearPersistedSession, loadPersistedSession, savePersistedSession } from '@/auth/session-storage';
import type { CustomerAuthSession, CustomerAuthUser } from '@/auth/types';
import { getOrCreateInstallationId } from '@/utils/installation-id';
import { apiClient } from '@/services/api-client';

interface AuthContextType {
  user: CustomerAuthUser | null;
  session: CustomerAuthSession | null;
  role: 'CUSTOMER' | null;
  loading: boolean;
  lastOtpVerifiedAt: number | null;
  markOtpVerified: () => void;
  hasFreshOtp: (maxAgeMs?: number) => boolean;
  setSession: (session: CustomerAuthSession | null) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<CustomerAuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const lastOtpVerifiedAtRef = useRef<number | null>(null);
  const [lastOtpVerifiedAt, setLastOtpVerifiedAt] = useState<number | null>(null);
  const activeSessionRef = useRef<CustomerAuthSession | null>(null);
  const authEpochRef = useRef(0);

  const applySessionState = useCallback((nextSession: CustomerAuthSession | null) => {
    activeSessionRef.current = nextSession;
    apiClient.setSessionToken(nextSession?.accessToken ?? null);
    setSessionState(nextSession);
  }, []);

  const setSession = useCallback(async (nextSession: CustomerAuthSession | null) => {
    if (!nextSession) {
      authEpochRef.current += 1;
      applySessionState(null);
      await clearPersistedSession();
      return;
    }

    validateServerRole(nextSession.role);
    if (!nextSession.mobile?.trim()) {
      throw new Error('CustomerAuthSession mobile is required');
    }

    const deviceId = await getOrCreateInstallationId();
    // 1. Persist restart state FIRST
    await savePersistedSession({
      refreshToken: nextSession.refreshToken,
      refreshTokenExpiresAt: nextSession.refreshTokenExpiresAt,
      accountId: nextSession.accountId,
      mobile: nextSession.mobile,
      role: 'CUSTOMER',
      deviceId,
    });

    // 2. Publish authenticated state ONLY if persistence succeeds
    applySessionState(nextSession);
  }, [applySessionState]);

  const refreshActiveSession = useCallback(async (): Promise<string | null> => {
    const epochAtStart = authEpochRef.current;
    try {
      const persisted = await loadPersistedSession();
      if (!persisted) {
        applySessionState(null);
        await clearPersistedSession();
        return null;
      }

      const rotatedSession = await apiClient.post<OtpSessionResponse>('/api/v1/auth/sessions/refresh', {
        refreshToken: persisted.refreshToken,
      });

      // Race check: if user signed out while refresh was in-flight, discard!
      if (authEpochRef.current !== epochAtStart) {
        applySessionState(null);
        await clearPersistedSession();
        return null;
      }

      validateServerRole(rotatedSession.role);

      const deviceId = persisted.deviceId || (await getOrCreateInstallationId());
      const completeSession: CustomerAuthSession = {
        accountId: rotatedSession.accountId,
        accessToken: rotatedSession.accessToken,
        refreshToken: rotatedSession.refreshToken,
        tokenType: rotatedSession.tokenType || 'Bearer',
        accessTokenExpiresAt: rotatedSession.accessTokenExpiresAt,
        refreshTokenExpiresAt: rotatedSession.refreshTokenExpiresAt,
        role: 'CUSTOMER',
        mobile: persisted.mobile,
      };

      // 1. Persist restart state FIRST
      await savePersistedSession({
        refreshToken: completeSession.refreshToken,
        refreshTokenExpiresAt: completeSession.refreshTokenExpiresAt,
        accountId: completeSession.accountId,
        mobile: completeSession.mobile,
        role: 'CUSTOMER',
        deviceId,
      });

      // 2. Race check AGAIN after async save
      if (authEpochRef.current !== epochAtStart) {
        applySessionState(null);
        await clearPersistedSession();
        return null;
      }

      applySessionState(completeSession);
      return completeSession.accessToken;
    } catch (error) {
      console.warn('Session refresh failed:', error);
      applySessionState(null);
      await clearPersistedSession();
      return null;
    }
  }, [applySessionState]);

  const clearAuthState = useCallback(() => {
    authEpochRef.current += 1;
    lastOtpVerifiedAtRef.current = null;
    setLastOtpVerifiedAt(null);
    applySessionState(null);
    void clearPersistedSession();
  }, [applySessionState]);

  // Wire apiClient callbacks
  useEffect(() => {
    apiClient.setRefreshHandler(refreshActiveSession);
    apiClient.setClearAuthHandler(clearAuthState);

    return () => {
      apiClient.setRefreshHandler(null);
      apiClient.setClearAuthHandler(null);
    };
  }, [clearAuthState, refreshActiveSession]);

  // Cold start session restoration
  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const persisted = await loadPersistedSession();
        if (!persisted) {
          if (active) {
            applySessionState(null);
            setLoading(false);
          }
          return;
        }

        // Rotate session on cold start
        const accessToken = await refreshActiveSession();
        if (!active) return;
        if (!accessToken) {
          applySessionState(null);
        }
      } catch (error) {
        console.warn('Cold start session restoration failed:', error);
        if (active) applySessionState(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, [applySessionState, refreshActiveSession]);

  const markOtpVerified = useCallback(() => {
    const now = Date.now();
    lastOtpVerifiedAtRef.current = now;
    setLastOtpVerifiedAt(now);
  }, []);

  const hasFreshOtp = useCallback((maxAgeMs = 5 * 60_000) => {
    return isFreshOtp(lastOtpVerifiedAtRef.current, Date.now(), maxAgeMs);
  }, []);

  const signOut = useCallback(async () => {
    authEpochRef.current += 1;
    const currentToken = activeSessionRef.current?.accessToken;
    lastOtpVerifiedAtRef.current = null;
    setLastOtpVerifiedAt(null);
    applySessionState(null);
    await clearPersistedSession();

    if (currentToken) {
      try {
        await apiClient.delete('/api/v1/auth/sessions/current', {
          Authorization: `Bearer ${currentToken}`,
        });
      } catch (error) {
        console.warn('Backend logout call failed, session cleared locally:', error);
      }
    }
  }, [applySessionState]);

  const user = useMemo<CustomerAuthUser | null>(() => {
    if (!session) return null;
    return {
      id: session.accountId,
      phone: session.mobile,
      displayName: null,
    };
  }, [session]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      session,
      role: session ? 'CUSTOMER' : null,
      loading,
      lastOtpVerifiedAt,
      markOtpVerified,
      hasFreshOtp,
      setSession,
      signOut,
    }),
    [hasFreshOtp, lastOtpVerifiedAt, loading, markOtpVerified, session, setSession, signOut, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
