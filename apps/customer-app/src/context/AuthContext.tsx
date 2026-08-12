import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { isFreshOtp } from '@/auth/fresh-otp';
import { apiClient } from '@/services/api-client';
import { syncCommunicationContact } from '@/services/communication-contact';
import { syncAuthenticatedProfile } from '@/utils/profile-sync';
import { supabase } from '@/utils/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: string | null;
  loading: boolean;
  lastOtpVerifiedAt: number | null;
  markOtpVerified: () => void;
  hasFreshOtp: (maxAgeMs?: number) => boolean;
  signOut: () => Promise<void>;
  signInWithMockPhone?: (phone: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastOtpVerifiedAtRef = useRef<number | null>(null);
  const lastContactFingerprintRef = useRef<string | null>(null);
  const [lastOtpVerifiedAt, setLastOtpVerifiedAt] = useState<number | null>(null);

  const applySession = useCallback((nextSession: Session | null) => {
    apiClient.setSessionToken(nextSession?.access_token ?? null);
    setSession(nextSession);
    setLoading(false);

    if (!nextSession) {
      lastContactFingerprintRef.current = null;
      return;
    }

    void syncAuthenticatedProfile(nextSession, 'CUSTOMER').catch((error) => {
      console.warn('Profile sync failed', error);
    });

    const metadata = nextSession.user.user_metadata ?? {};
    const fingerprint = [
      nextSession.user.id,
      nextSession.user.email ?? '',
      nextSession.user.phone ?? '',
      typeof metadata.full_name === 'string' ? metadata.full_name : '',
      typeof metadata.name === 'string' ? metadata.name : '',
    ].join('|');

    if (lastContactFingerprintRef.current !== fingerprint) {
      void syncCommunicationContact(nextSession.access_token)
        .then(() => {
          lastContactFingerprintRef.current = fingerprint;
        })
        .catch((error) => {
          console.warn('Communication contact sync failed', error);
        });
    }
  }, []);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.warn('Session restoration failed', error);
      applySession(error ? null : data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) applySession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const markOtpVerified = useCallback(() => {
    const now = Date.now();
    lastOtpVerifiedAtRef.current = now;
    setLastOtpVerifiedAt(now);
  }, []);

  const hasFreshOtp = useCallback((maxAgeMs = 5 * 60_000) => {
    return isFreshOtp(lastOtpVerifiedAtRef.current, Date.now(), maxAgeMs);
  }, []);

  const signOut = useCallback(async () => {
    lastOtpVerifiedAtRef.current = null;
    lastContactFingerprintRef.current = null;
    setLastOtpVerifiedAt(null);
    apiClient.setSessionToken(null);

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user: session?.user ?? null,
      session,
      role:
        (session?.user?.app_metadata?.role as string | undefined) ??
        (session ? 'CUSTOMER' : null),
      loading,
      lastOtpVerifiedAt,
      markOtpVerified,
      hasFreshOtp,
      signOut,
    }),
    [hasFreshOtp, lastOtpVerifiedAt, loading, markOtpVerified, session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
