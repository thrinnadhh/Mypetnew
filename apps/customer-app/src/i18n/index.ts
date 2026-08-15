import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import hi from './hi.json';
import productionAuthEn from './production-auth-en.json';
import productionAuthHi from './production-auth-hi.json';
import s10En from './s10-en.json';
import s10Hi from './s10-hi.json';
import te from './te.json';

type Dictionary = Record<string, unknown>;
function deepMerge(base: Dictionary, overlay: Dictionary): Dictionary {
  const result: Dictionary = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)
      ? deepMerge(current as Dictionary, value as Dictionary)
      : value;
  }
  return result;
}

const deviceLang = Localization.getLocales()[0]?.languageCode ?? 'en';
const initialLanguage = deviceLang === 'te' ? 'te' : deviceLang === 'hi' ? 'hi' : 'en';

const english = deepMerge(deepMerge(en as Dictionary, s10En as Dictionary), productionAuthEn as Dictionary);
const hindi = deepMerge(deepMerge(hi as Dictionary, s10Hi as Dictionary), productionAuthHi as Dictionary);

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources: {
    en: { translation: english },
    hi: { translation: hindi },
    te: { translation: te },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export { useTranslation } from 'react-i18next';
export default i18n;
export function t(key: string, options?: Record<string, unknown>): string { return i18n.t(key, options); }
