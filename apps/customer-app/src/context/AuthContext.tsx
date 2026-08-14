import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { isFreshOtp } from '@/auth/fresh-otp';
import { validateServerRole, type OtpSessionResponse } from '@/auth/otp-auth';
import { clearPersistedSession, loadPersistedSession, savePersistedSession } from '@/auth/session-storage';
import type { CustomerAuthSession, CustomerAuthUser } from '@/auth/types';
import { apiClient } from '@/services/api-client';
import { revokeDeviceRegistration } from '@/hooks/usePushNotifications';
import { getOrCreateInstallationId } from '@/utils/installation-id';

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
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());

  const runStorageMutation = useCallback(async (mutation: () => Promise<void>) => {
    const run = storageQueueRef.current.catch(() => undefined).then(mutation);
    storageQueueRef.current = run.catch(() => undefined);
    await run;
  }, []);

  const applySessionState = useCallback((nextSession: CustomerAuthSession | null) => {
    activeSessionRef.current = nextSession;
    apiClient.setSessionToken(nextSession?.accessToken ?? null);
    setSessionState(nextSession);
  }, []);

  const setSession = useCallback(async (nextSession: CustomerAuthSession | null) => {
    if (!nextSession) {
      authEpochRef.current += 1;
      applySessionState(null);
      await runStorageMutation(clearPersistedSession);
      return;
    }

    const role = validateServerRole(nextSession.role);
    if (!nextSession.mobile?.trim()) {
      throw new Error('CustomerAuthSession mobile is required');
    }

    // A newly established login is a new auth generation. Any older refresh/request must
    // become stale even if there was no intermediate sign-out call.
    const sessionEpoch = ++authEpochRef.current;
    apiClient.advanceAuthEpoch();
    const deviceId = await getOrCreateInstallationId();

    await runStorageMutation(async () => {
      if (authEpochRef.current !== sessionEpoch) return;
      await savePersistedSession({
        refreshToken: nextSession.refreshToken,
        refreshTokenExpiresAt: nextSession.refreshTokenExpiresAt,
        accountId: nextSession.accountId,
        mobile: nextSession.mobile,
        role,
        deviceId,
      });
    });

    if (authEpochRef.current !== sessionEpoch) return;
    applySessionState({ ...nextSession, role });
  }, [applySessionState, runStorageMutation]);

  const refreshActiveSession = useCallback(async (): Promise<string | null> => {
    const epochAtStart = authEpochRef.current;

    try {
      const persisted = await loadPersistedSession();
      if (authEpochRef.current !== epochAtStart) return null;

      if (!persisted) {
        applySessionState(null);
        return null;
      }

      const rotatedSession = await apiClient.post<OtpSessionResponse>('/api/v1/auth/sessions/refresh', {
        refreshToken: persisted.refreshToken,
      });

      // A newer login/sign-out superseded this refresh. Stale work must not clear it.
      if (authEpochRef.current !== epochAtStart) return null;

      const role = validateServerRole(rotatedSession.role);
      const deviceId = persisted.deviceId || (await getOrCreateInstallationId());
      const completeSession: CustomerAuthSession = {
        accountId: rotatedSession.accountId,
        accessToken: rotatedSession.accessToken,
        refreshToken: rotatedSession.refreshToken,
        tokenType: rotatedSession.tokenType || 'Bearer',
        accessTokenExpiresAt: rotatedSession.accessTokenExpiresAt,
        refreshTokenExpiresAt: rotatedSession.refreshTokenExpiresAt,
        role,
        mobile: persisted.mobile,
      };

      await runStorageMutation(async () => {
        if (authEpochRef.current !== epochAtStart) return;
        await savePersistedSession({
          refreshToken: completeSession.refreshToken,
          refreshTokenExpiresAt: completeSession.refreshTokenExpiresAt,
          accountId: completeSession.accountId,
          mobile: completeSession.mobile,
          role,
          deviceId,
        });
      });

      if (authEpochRef.current !== epochAtStart) return null;

      applySessionState(completeSession);
      return completeSession.accessToken;
    } catch (error) {
      // Only the auth generation that started this refresh may clear itself. A stale
      // refresh failure must never destroy a newer login.
      if (authEpochRef.current === epochAtStart) {
        console.warn('Session refresh failed:', error);
        applySessionState(null);
        await runStorageMutation(clearPersistedSession);
      }
      return null;
    }
  }, [applySessionState, runStorageMutation]);

  const clearAuthState = useCallback(() => {
    authEpochRef.current += 1;
    lastOtpVerifiedAtRef.current = null;
    setLastOtpVerifiedAt(null);
    applySessionState(null);
    void runStorageMutation(clearPersistedSession);
  }, [applySessionState, runStorageMutation]);

  useEffect(() => {
    apiClient.setRefreshHandler(refreshActiveSession);
    apiClient.setClearAuthHandler(clearAuthState);

    return () => {
      apiClient.setRefreshHandler(null);
      apiClient.setClearAuthHandler(null);
    };
  }, [clearAuthState, refreshActiveSession]);

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

    if (currentToken) {
      try {
        const installationId = await getOrCreateInstallationId().catch(() => null);
        if (installationId) {
          await revokeDeviceRegistration(installationId, currentToken);
        }
      } catch (error) {
        console.warn('Device registration revoke failed during sign out:', error);
      }

      try {
        await apiClient.delete('/api/v1/auth/sessions/current', {
          Authorization: `Bearer ${currentToken}`,
        });
      } catch (error) {
        console.warn('Backend logout call failed, session cleared locally:', error);
      }
    }

    applySessionState(null);
    await runStorageMutation(clearPersistedSession);
  }, [applySessionState, runStorageMutation]);

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
      role: session?.role ?? null,
      loading,
      lastOtpVerifiedAt,
      markOtpVerified,
      hasFreshOtp,
      setSession,
      signOut,
    }),
    [hasFreshOtp, lastOtpVerifiedAt, loading, markOtpVerified, session, setSession, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
