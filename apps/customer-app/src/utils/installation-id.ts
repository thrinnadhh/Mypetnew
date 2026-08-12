import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const INSTALLATION_ID_KEY = 'mypetnew_installation_id';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

let cachedInstallationId: string | null = null;

export async function getOrCreateInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  try {
    if (Platform.OS === 'web') {
      let storedId: string | null = null;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        storedId = window.sessionStorage.getItem(INSTALLATION_ID_KEY);
      }
      if (storedId) {
        cachedInstallationId = storedId;
        return storedId;
      }
      const newId = Crypto.randomUUID();
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(INSTALLATION_ID_KEY, newId);
      }
      cachedInstallationId = newId;
      return newId;
    } else {
      const storedId = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
      if (storedId) {
        cachedInstallationId = storedId;
        return storedId;
      }
      const newId = Crypto.randomUUID();
      await SecureStore.setItemAsync(INSTALLATION_ID_KEY, newId, secureOptions);
      cachedInstallationId = newId;
      return newId;
    }
  } catch (error) {
    console.warn('Failed to access secure installation storage, using memory fallback:', error);
    const fallbackId = Crypto.randomUUID();
    cachedInstallationId = fallbackId;
    return fallbackId;
  }
}

export function clearCachedInstallationIdForTesting(): void {
  cachedInstallationId = null;
}
