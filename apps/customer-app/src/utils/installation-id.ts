import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const INSTALLATION_ID_KEY = 'mypetnew_installation_id';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedInstallationId: string | null = null;

function isValidInstallationId(value: string | null): value is string {
  return Boolean(value && value.length <= 128 && UUID_V4.test(value));
}

export async function getOrCreateInstallationId(): Promise<string> {
  if (cachedInstallationId) return cachedInstallationId;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      throw new Error('Installation storage is unavailable');
    }

    const storedId = window.sessionStorage.getItem(INSTALLATION_ID_KEY);
    if (isValidInstallationId(storedId)) {
      cachedInstallationId = storedId;
      return storedId;
    }

    const newId = Crypto.randomUUID();
    window.sessionStorage.setItem(INSTALLATION_ID_KEY, newId);
    cachedInstallationId = newId;
    return newId;
  }

  const storedId = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (isValidInstallationId(storedId)) {
    cachedInstallationId = storedId;
    return storedId;
  }

  const newId = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, newId, secureOptions);
  cachedInstallationId = newId;
  return newId;
}

export function clearCachedInstallationIdForTesting(): void {
  cachedInstallationId = null;
}
