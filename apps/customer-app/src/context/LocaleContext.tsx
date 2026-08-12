import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { LanguageId } from '@/constants/content';
import { useAuth } from '@/context/AuthContext';
import i18n from '@/i18n';
import { fetchLocale, updateLocale } from '@/services/preferences';

interface LocaleContextValue { locale: LanguageId; changeLocale: (next: LanguageId) => Promise<void>; ready: boolean }
const LocaleContext = createContext<LocaleContextValue | null>(null);
const supported = (value?: string | null): LanguageId => value === 'te' ? 'te' : value === 'hi' ? 'hi' : 'en';

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [locale, setLocale] = useState<LanguageId>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!session?.access_token) {
      const next = supported(i18n.language);
      setLocale(next);
      void i18n.changeLanguage(next).then(() => { if (!cancelled) setReady(true); });
      return () => { cancelled = true; };
    }
    void fetchLocale(session.access_token).then(async (preferred) => {
      if (cancelled) return;
      const next = supported(preferred);
      setLocale(next);
      await i18n.changeLanguage(next);
      setReady(true);
    }).catch(async () => {
      if (cancelled) return;
      const next = supported(i18n.language);
      setLocale(next);
      await i18n.changeLanguage(next);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [session?.access_token]);

  const changeLocale = useCallback(async (next: LanguageId) => {
    const normalized = supported(next);
    setLocale(normalized);
    await i18n.changeLanguage(normalized);
    await updateLocale(normalized, session?.access_token);
  }, [session?.access_token]);

  const value = useMemo(() => ({ locale, changeLocale, ready }), [changeLocale, locale, ready]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used within LocaleProvider');
  return context;
}
