import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { appConfig, requireMobileConfig } from './app-config';

requireMobileConfig();

const supabaseUrl = appConfig.supabaseUrl || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = appConfig.supabaseAnonKey || 'placeholder-anon-key';
const CHUNK_SIZE = 1800;
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

const webStorage = {
  getItem: (key: string) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
  removeItem: (key: string) => { if (typeof window !== 'undefined') window.localStorage.removeItem(key); },
};

async function removeSecureChunks(key: string) {
  const count = Number(await SecureStore.getItemAsync(`${key}.count`)) || 0;
  await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(`${key}.${index}`)));
  await Promise.all([SecureStore.deleteItemAsync(`${key}.count`), SecureStore.deleteItemAsync(key)]);
}

const nativeStorage = {
  async getItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(`${key}.count`)) || 0;
    if (count === 0) return SecureStore.getItemAsync(key);
    const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${key}.${index}`)));
    return chunks.every((chunk): chunk is string => chunk !== null) ? chunks.join('') : null;
  },
  async setItem(key: string, value: string) {
    await removeSecureChunks(key);
    const chunks = Array.from({ length: Math.ceil(value.length / CHUNK_SIZE) }, (_, index) => value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(`${key}.${index}`, chunk, secureOptions)));
    await SecureStore.setItemAsync(`${key}.count`, String(chunks.length), secureOptions);
  },
  removeItem: removeSecureChunks,
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : nativeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
