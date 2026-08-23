import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiError, ErrorCodes } from '../utils/errors';
import { CaptainSessionEnvelope } from './types';

type StoredRefreshState = {
  version: 1;
  accountId: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

type RefreshFlight = {
  tokenGeneration: number;
  authOperationGeneration: number;
  promise: Promise<CaptainSessionEnvelope>;
};

const REFRESH_STATE_KEY = 'mypetnew.captain.refresh.v1';
const DEVICE_ID_KEY = 'mypetnew.captain.installation.v1';

let runtimeAccessToken: string | null = null;
let accessTokenGeneration = 0;
let authOperationGeneration = 0;
let runtimeWebInstallationId: string | null = null;
let refreshInFlight: RefreshFlight | null = null;
let storageMutationTail: Promise<void> = Promise.resolve();

export function getApiBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `http://${hostname}:8080`;
    }
  }

  const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:8080';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'http://localhost:8080';
  }

  const localDevHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '10.0.2.2' ||
    parsed.hostname.startsWith('192.168.');

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localDevHost)) {
    throw new ApiError({
      code: ErrorCodes.NETWORK_ERROR,
      message: 'Captain API configuration must use HTTPS in production',
    });
  }
  return raw.replace(/\/$/, '');
}

function serializeStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageMutationTail.then(operation, operation);
  storageMutationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return null;
  }
  await storageMutationTail;
  return SecureStore.getItemAsync(key);
}

function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
    return Promise.resolve();
  }
  return serializeStorageMutation(() => SecureStore.setItemAsync(key, value));
}

function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
    return Promise.resolve();
  }
  return serializeStorageMutation(() => SecureStore.deleteItemAsync(key));
}

function refreshStateJson(session: CaptainSessionEnvelope): string {
  const state: StoredRefreshState = {
    version: 1,
    accountId: session.accountId,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  };
  return JSON.stringify(state);
}

export async function getInstallationDeviceId(): Promise<string> {
  if (Platform.OS === 'web') {
    if (!runtimeWebInstallationId) {
      runtimeWebInstallationId = `captain-web-${Crypto.randomUUID()}`;
    }
    return runtimeWebInstallationId;
  }
  const existing = await storageGet(DEVICE_ID_KEY);
  if (existing) return existing;

  const created = `captain-device-${Crypto.randomUUID()}`;
  await storageSet(DEVICE_ID_KEY, created);
  return created;
}

export async function storeSession(session: CaptainSessionEnvelope): Promise<void> {
  if (session.role !== 'CAPTAIN') {
    throw new ApiError({
      code: ErrorCodes.AUTHENTICATION_REQUIRED,
      message: 'Invalid role for Captain application',
    });
  }

  const currentOp = ++authOperationGeneration;
  runtimeAccessToken = session.accessToken;
  accessTokenGeneration++;

  const value = refreshStateJson(session);
  await storageSet(REFRESH_STATE_KEY, value);
}

export async function clearSession(): Promise<void> {
  ++authOperationGeneration;
  runtimeAccessToken = null;
  accessTokenGeneration++;
  refreshInFlight = null;

  await storageDelete(REFRESH_STATE_KEY);
}

export async function getStoredRefreshState(): Promise<StoredRefreshState | null> {
  const raw = await storageGet(REFRESH_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.refreshToken) {
      return parsed as StoredRefreshState;
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshCaptainSession(): Promise<CaptainSessionEnvelope> {
  const currentTokenGen = accessTokenGeneration;
  const currentAuthOp = authOperationGeneration;

  if (refreshInFlight && refreshInFlight.authOperationGeneration === currentAuthOp) {
    return refreshInFlight.promise;
  }

  const refreshPromise = (async () => {
    const state = await getStoredRefreshState();
    if (!state) {
      await clearSession();
      throw new ApiError({
        code: ErrorCodes.AUTHENTICATION_REQUIRED,
        message: 'No active session found',
        status: 401,
      });
    }

    const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/sessions/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });

    if (!res.ok) {
      await clearSession();
      throw new ApiError({
        code: ErrorCodes.AUTHENTICATION_REQUIRED,
        message: 'Session refresh failed',
        status: res.status,
      });
    }

    const data: CaptainSessionEnvelope = await res.json();
    if (data.role !== 'CAPTAIN') {
      await clearSession();
      throw new ApiError({
        code: ErrorCodes.AUTHENTICATION_REQUIRED,
        message: 'Invalid role returned during refresh',
        status: 403,
      });
    }

    await storeSession(data);
    return data;
  })();

  refreshInFlight = {
    tokenGeneration: currentTokenGen,
    authOperationGeneration: currentAuthOp,
    promise: refreshPromise,
  };

  try {
    return await refreshPromise;
  } finally {
    if (refreshInFlight?.promise === refreshPromise) {
      refreshInFlight = null;
    }
  }
}

export function getRuntimeAccessToken(): string | null {
  return runtimeAccessToken;
}

export function setRuntimeAccessTokenForTesting(token: string | null): void {
  runtimeAccessToken = token;
}
