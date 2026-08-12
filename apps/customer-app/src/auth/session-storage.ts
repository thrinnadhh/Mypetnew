import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { PersistedRefreshState } from './types';

const SESSION_STORAGE_KEY = 'mypetnew_customer_session_v1';
const STORAGE_VERSION = 1;
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;
const INDIAN_MOBILE = /^\+91[6-9][0-9]{9}$/;

type StoredSessionEnvelope = {
  version: number;
  state: PersistedRefreshState;
};

function normalizePersistedState(value: unknown): PersistedRefreshState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PersistedRefreshState>;

  if (
    typeof candidate.refreshToken !== 'string' || !candidate.refreshToken.trim() ||
    typeof candidate.refreshTokenExpiresAt !== 'string' || !candidate.refreshTokenExpiresAt.trim() ||
    typeof candidate.accountId !== 'string' || !candidate.accountId.trim() ||
    typeof candidate.mobile !== 'string' || !INDIAN_MOBILE.test(candidate.mobile.trim()) ||
    candidate.role !== 'CUSTOMER' ||
    typeof candidate.deviceId !== 'string' || !candidate.deviceId.trim() || candidate.deviceId.length > 128
  ) {
    return null;
  }

  const expiresAtMs = Date.parse(candidate.refreshTokenExpiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) return null;

  return {
    refreshToken: candidate.refreshToken.trim(),
    refreshTokenExpiresAt: candidate.refreshTokenExpiresAt.trim(),
    accountId: candidate.accountId.trim(),
    mobile: candidate.mobile.trim(),
    role: 'CUSTOMER',
    deviceId: candidate.deviceId.trim(),
  };
}

function encodeState(state: PersistedRefreshState): string {
  const normalized = normalizePersistedState(state);
  if (!normalized) throw new Error('Persisted Customer session state is invalid');

  const envelope: StoredSessionEnvelope = {
    version: STORAGE_VERSION,
    state: normalized,
  };
  return JSON.stringify(envelope);
}

function decodeState(raw: string): PersistedRefreshState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSessionEnvelope>;
    if (parsed.version !== STORAGE_VERSION) return null;
    return normalizePersistedState(parsed.state);
  } catch {
    return null;
  }
}

export async function savePersistedSession(state: PersistedRefreshState): Promise<void> {
  const encoded = encodeState(state);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      throw new Error('Customer session storage is unavailable');
    }
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, encoded);
    return;
  }

  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, encoded, secureOptions);
}

export async function loadPersistedSession(): Promise<PersistedRefreshState | null> {
  let raw: string | null;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } else {
    raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  }

  if (!raw) return null;

  const state = decodeState(raw);
  if (state) return state;

  await clearPersistedSession();
  return null;
}

export async function clearPersistedSession(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}
