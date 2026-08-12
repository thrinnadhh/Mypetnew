import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

import type { AuthIntent } from '@/auth/auth-intent';
import { serializeAuthIntent } from '@/auth/auth-intent';
import { useAuth } from '@/context/AuthContext';

type ResumeCallback = () => void | Promise<void>;

interface PendingIntent { intent: AuthIntent; callback?: ResumeCallback }
interface AuthIntentContextValue {
  requireAuth: (intent: AuthIntent, onAuthenticated?: ResumeCallback) => Promise<boolean>;
  requireFreshOtp: (intent: AuthIntent, onVerified?: ResumeCallback) => Promise<boolean>;
  resumePendingIntent: (fallback?: AuthIntent | null) => Promise<void>;
  clearPendingIntent: () => void;
}

const AuthIntentContext = createContext<AuthIntentContextValue | null>(null);

export function AuthIntentProvider({ children }: { children: React.ReactNode }) {
  const { session, hasFreshOtp } = useAuth();
  const router = useRouter();
  const pending = useRef<PendingIntent | null>(null);

  const openOtp = useCallback((intent: AuthIntent, callback: ResumeCallback | undefined, fresh: boolean) => {
    pending.current = { intent, callback };
    router.push({ pathname: '/login', params: { intent: serializeAuthIntent(intent), fresh: fresh ? '1' : '0' } } as never);
  }, [router]);

  const requireAuth = useCallback(async (intent: AuthIntent, callback?: ResumeCallback) => {
    if (session) {
      await callback?.();
      return true;
    }
    openOtp(intent, callback, false);
    return false;
  }, [openOtp, session]);

  const requireFreshOtp = useCallback(async (intent: AuthIntent, callback?: ResumeCallback) => {
    if (session && hasFreshOtp()) {
      await callback?.();
      return true;
    }
    openOtp(intent, callback, true);
    return false;
  }, [hasFreshOtp, openOtp, session]);

  const clearPendingIntent = useCallback(() => { pending.current = null; }, []);

  const resumePendingIntent = useCallback(async (fallback?: AuthIntent | null) => {
    const item = pending.current;
    pending.current = null;
    if (item?.callback) await item.callback();
    const intent = item?.intent ?? fallback;
    if (intent) router.replace({ pathname: intent.returnTo, params: intent.params } as never);
    else router.replace('/(tabs)/home' as never);
  }, [router]);

  const value = useMemo(() => ({ requireAuth, requireFreshOtp, resumePendingIntent, clearPendingIntent }), [clearPendingIntent, requireAuth, requireFreshOtp, resumePendingIntent]);
  return <AuthIntentContext.Provider value={value}>{children}</AuthIntentContext.Provider>;
}

export function useAuthIntent() {
  const value = useContext(AuthIntentContext);
  if (!value) throw new Error('useAuthIntent must be used within AuthIntentProvider');
  return value;
}
