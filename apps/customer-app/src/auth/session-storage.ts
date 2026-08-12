import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { PersistedRefreshState } from './types';

const STORAGE_KEYS = {
  REFRESH_TOKEN: 'mypetnew_customer_refresh_token',
  REFRESH_EXPIRES_AT: 'mypetnew_customer_refresh_expires_at',
  ACCOUNT_ID: 'mypetnew_customer_account_id',
  MOBILE: 'mypetnew_customer_mobile',
  ROLE: 'mypetnew_customer_role',
  DEVICE_ID: 'mypetnew_customer_device_id',
} as const;

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

export async function savePersistedSession(state: PersistedRefreshState): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, state.refreshToken);
    window.sessionStorage.setItem(STORAGE_KEYS.REFRESH_EXPIRES_AT, state.refreshTokenExpiresAt);
    window.sessionStorage.setItem(STORAGE_KEYS.ACCOUNT_ID, state.accountId);
    window.sessionStorage.setItem(STORAGE_KEYS.MOBILE, state.mobile);
    window.sessionStorage.setItem(STORAGE_KEYS.ROLE, state.role);
    window.sessionStorage.setItem(STORAGE_KEYS.DEVICE_ID, state.deviceId);
  } else {
    await Promise.all([
      SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, state.refreshToken, secureOptions),
      SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_EXPIRES_AT, state.refreshTokenExpiresAt, secureOptions),
      SecureStore.setItemAsync(STORAGE_KEYS.ACCOUNT_ID, state.accountId, secureOptions),
      SecureStore.setItemAsync(STORAGE_KEYS.MOBILE, state.mobile, secureOptions),
      SecureStore.setItemAsync(STORAGE_KEYS.ROLE, state.role, secureOptions),
      SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, state.deviceId, secureOptions),
    ]);
  }
}

export async function loadPersistedSession(): Promise<PersistedRefreshState | null> {
  let refreshToken: string | null = null;
  let refreshTokenExpiresAt: string | null = null;
  let accountId: string | null = null;
  let mobile: string | null = null;
  let role: string | null = null;
  let deviceId: string | null = null;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    refreshToken = window.sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    refreshTokenExpiresAt = window.sessionStorage.getItem(STORAGE_KEYS.REFRESH_EXPIRES_AT);
    accountId = window.sessionStorage.getItem(STORAGE_KEYS.ACCOUNT_ID);
    mobile = window.sessionStorage.getItem(STORAGE_KEYS.MOBILE);
    role = window.sessionStorage.getItem(STORAGE_KEYS.ROLE);
    deviceId = window.sessionStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  } else {
    [refreshToken, refreshTokenExpiresAt, accountId, mobile, role, deviceId] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
      SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_EXPIRES_AT),
      SecureStore.getItemAsync(STORAGE_KEYS.ACCOUNT_ID),
      SecureStore.getItemAsync(STORAGE_KEYS.MOBILE),
      SecureStore.getItemAsync(STORAGE_KEYS.ROLE),
      SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID),
    ]);
  }

  if (
    !refreshToken?.trim() ||
    !refreshTokenExpiresAt?.trim() ||
    !accountId?.trim() ||
    !mobile?.trim() ||
    !deviceId?.trim() ||
    role !== 'CUSTOMER'
  ) {
    await clearPersistedSession();
    return null;
  }

  // Check expiration timestamp strictly
  const expiresAtMs = Date.parse(refreshTokenExpiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    await clearPersistedSession();
    return null;
  }

  return {
    refreshToken: refreshToken.trim(),
    refreshTokenExpiresAt: refreshTokenExpiresAt.trim(),
    accountId: accountId.trim(),
    mobile: mobile.trim(),
    role: 'CUSTOMER',
    deviceId: deviceId.trim(),
  };
}

export async function clearPersistedSession(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    window.sessionStorage.removeItem(STORAGE_KEYS.REFRESH_EXPIRES_AT);
    window.sessionStorage.removeItem(STORAGE_KEYS.ACCOUNT_ID);
    window.sessionStorage.removeItem(STORAGE_KEYS.MOBILE);
    window.sessionStorage.removeItem(STORAGE_KEYS.ROLE);
    window.sessionStorage.removeItem(STORAGE_KEYS.DEVICE_ID);
  } else {
    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_EXPIRES_AT),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ACCOUNT_ID),
      SecureStore.deleteItemAsync(STORAGE_KEYS.MOBILE),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ROLE),
      SecureStore.deleteItemAsync(STORAGE_KEYS.DEVICE_ID),
    ]);
  }
}
