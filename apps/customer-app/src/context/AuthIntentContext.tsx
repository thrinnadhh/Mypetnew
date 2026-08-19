import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

import type { AuthIntent } from '@/auth/auth-intent';
import { normalizeAuthIntent, serializeAuthIntent } from '@/auth/auth-intent';
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

  const normalizedOrHome = useCallback((intent: AuthIntent): AuthIntent | null => {
    const normalized = normalizeAuthIntent(intent);
    if (!normalized) {
      pending.current = null;
      router.replace('/(tabs)/home' as never);
      return null;
    }
    return normalized;
  }, [router]);

  const openOtp = useCallback((intent: AuthIntent, callback: ResumeCallback | undefined, fresh: boolean) => {
    const normalized = normalizedOrHome(intent);
    if (!normalized) return false;
    pending.current = { intent: normalized, callback };
    router.push({ pathname: '/login', params: { intent: serializeAuthIntent(normalized), fresh: fresh ? '1' : '0' } } as never);
    return true;
  }, [normalizedOrHome, router]);

  const requireAuth = useCallback(async (intent: AuthIntent, callback?: ResumeCallback) => {
    const normalized = normalizedOrHome(intent);
    if (!normalized) return false;
    if (session) {
      await callback?.();
      return true;
    }
    openOtp(normalized, callback, false);
    return false;
  }, [normalizedOrHome, openOtp, session]);

  const requireFreshOtp = useCallback(async (intent: AuthIntent, callback?: ResumeCallback) => {
    const normalized = normalizedOrHome(intent);
    if (!normalized) return false;
    if (session && hasFreshOtp()) {
      await callback?.();
      return true;
    }
    openOtp(normalized, callback, true);
    return false;
  }, [hasFreshOtp, normalizedOrHome, openOtp, session]);

  const clearPendingIntent = useCallback(() => { pending.current = null; }, []);

  const resumePendingIntent = useCallback(async (fallback?: AuthIntent | null) => {
    const item = pending.current;
    pending.current = null;
    const intent = normalizeAuthIntent(item?.intent ?? fallback ?? null);
    if (!intent) {
      router.replace('/(tabs)/home' as never);
      return;
    }
    if (item?.callback) await item.callback();
    router.replace({ pathname: intent.returnTo, params: intent.params } as never);
  }, [router]);

  const value = useMemo(() => ({ requireAuth, requireFreshOtp, resumePendingIntent, clearPendingIntent }), [clearPendingIntent, requireAuth, requireFreshOtp, resumePendingIntent]);
  return <AuthIntentContext.Provider value={value}>{children}</AuthIntentContext.Provider>;
}

export function useAuthIntent() {
  const value = useContext(AuthIntentContext);
  if (!value) throw new Error('useAuthIntent must be used within AuthIntentProvider');
  return value;
}
