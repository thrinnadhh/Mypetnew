import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://gxxmbmcezyuqwywblzlh.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4eG1ibWNlenl1cXd5d2JsemxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTc4NjksImV4cCI6MjEwMjAzMzg2OX0.dsd6W3lYNAJZLQ57y6gDrUnd618Lzx2SGV1DLyP2rws';

const ephemeralWebStorage = new Map<string, string>();

const webStorage = {
  getItem: (key: string) => ephemeralWebStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    ephemeralWebStorage.set(key, value);
  },
  removeItem: (key: string) => {
    ephemeralWebStorage.delete(key);
  },
};

const nativeStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : nativeStorage,
    autoRefreshToken: true,
    persistSession: Platform.OS !== 'web',
    detectSessionInUrl: false,
  },
});
