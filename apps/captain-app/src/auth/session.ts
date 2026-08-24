import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { AppError } from '../domain/result';
import { CaptainSessionEnvelope } from './types';

export type StoredRefreshState = {
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
const REFRESH_TIMEOUT_MS = 15_000;

let authGeneration = 0;
let runtimeAccessToken: string | null = null;
let runtimeAccountId: string | null = null;
let runtimeWebInstallationId: string | null = null;
let runtimeNativeInstallationId: string | null = null;
let refreshInFlight: RefreshFlight | null = null;
let storageMutationTail: Promise<void> = Promise.resolve();

export function getAuthGeneration(): number {
  return authGeneration;
}

export function getRuntimeAccountId(): string | null {
  return runtimeAccountId;
}

export function validateCaptainSessionEnvelope(payload: unknown): CaptainSessionEnvelope {
  if (!payload || typeof payload !== 'object') {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
      message: 'Session response must be a non-null object',
    });
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.accountId !== 'string' || !p.accountId.trim()) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
      message: 'Session missing valid accountId',
    });
  }

  if (typeof p.accessToken !== 'string' || !p.accessToken.trim()) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
      message: 'Session missing valid accessToken',
    });
  }

  if (typeof p.refreshToken !== 'string' || !p.refreshToken.trim()) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
      message: 'Session missing valid refreshToken',
    });
  }

  if (
    typeof p.accessTokenExpiresAt !== 'string' ||
    !p.accessTokenExpiresAt.trim() ||
    Number.isNaN(Date.parse(p.accessTokenExpiresAt))
  ) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
      message: 'Session missing valid accessTokenExpiresAt ISO timestamp',
    });
  }

  if (
    typeof p.refreshTokenExpiresAt !== 'string' ||
    !p.refreshTokenExpiresAt.trim() ||
    Number.isNaN(Date.parse(p.refreshTokenExpiresAt))
  ) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MALFORMED_SESSION_PAYLOAD',
      message: 'Session missing valid refreshTokenExpiresAt ISO timestamp',
    });
  }

  if (p.role !== 'CAPTAIN') {
    throw AppError.fromHttp(403, {
      code: 'AUTHORIZATION_DENIED',
      message: `Invalid role '${p.role}' for Captain application. Only role CAPTAIN is authorized.`,
    });
  }

  return {
    accountId: p.accountId.trim(),
    accessToken: p.accessToken.trim(),
    refreshToken: p.refreshToken.trim(),
    tokenType: typeof p.tokenType === 'string' && p.tokenType.trim() ? p.tokenType.trim() : 'Bearer',
    accessTokenExpiresAt: p.accessTokenExpiresAt,
    refreshTokenExpiresAt: p.refreshTokenExpiresAt,
    role: 'CAPTAIN',
  };
}

export function resolveApiBaseUrl(
  configuredValue: string | undefined,
  environmentValue: string | undefined,
  browserHostname?: string,
): string {
  const configured = configuredValue?.trim();
  const appEnvironment = environmentValue?.trim().toLowerCase() || 'development';

  if (!['development', 'staging', 'production'].includes(appEnvironment)) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'INVALID_APP_ENVIRONMENT',
      message: 'EXPO_PUBLIC_APP_ENV must be development, staging, or production',
    });
  }

  const browserDevelopmentBase =
    !configured &&
    appEnvironment === 'development' &&
    (browserHostname === 'localhost' || browserHostname === '127.0.0.1')
      ? `http://${browserHostname}:8080`
      : undefined;

  if (!configured && !browserDevelopmentBase && appEnvironment !== 'development') {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'MISSING_API_CONFIGURATION',
      message: 'EXPO_PUBLIC_API_BASE_URL is required outside development',
    });
  }

  const raw = configured || browserDevelopmentBase || 'http://localhost:8080';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'INVALID_API_CONFIGURATION',
      message: 'EXPO_PUBLIC_API_BASE_URL must be a valid absolute URL',
    });
  }

  const localDevHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '10.0.2.2' ||
    parsed.hostname.startsWith('192.168.');

  const localHttpAllowed = appEnvironment === 'development' && parsed.protocol === 'http:' && localDevHost;
  if (parsed.protocol !== 'https:' && !localHttpAllowed) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'INSECURE_CONFIGURATION',
      message: 'Captain API configuration must use HTTPS in production',
    });
  }
  return raw.replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  const browserHostname =
    Platform.OS === 'web' && typeof window !== 'undefined' && window.location
      ? window.location.hostname
      : undefined;
  return resolveApiBaseUrl(
    process.env.EXPO_PUBLIC_API_BASE_URL,
    process.env.EXPO_PUBLIC_APP_ENV,
    browserHostname,
  );
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
    // Invariant A9: Do not store or read refresh credentials from browser localStorage.
    return null;
  }
  await storageMutationTail;
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    throw new AppError({
      kind: 'ServerFailure',
      code: 'SECURE_STORAGE_ERROR',
      message: 'Failed to read from secure storage',
    });
  }
}

function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Invariant A9: Do not store refresh tokens in localStorage on web.
    return Promise.resolve();
  }
  return serializeStorageMutation(async () => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      throw new AppError({
        kind: 'ServerFailure',
        code: 'SECURE_STORAGE_ERROR',
        message: 'Failed to write to secure storage',
      });
    }
  });
}

function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    return Promise.resolve();
  }
  return serializeStorageMutation(async () => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Ignore delete errors during cleanup to fail closed gracefully
    }
  });
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
      runtimeWebInstallationId = Crypto.randomUUID();
    }
    return runtimeWebInstallationId;
  }
  try {
    const existing = await storageGet(DEVICE_ID_KEY);
    if (existing) {
      runtimeNativeInstallationId = existing;
      return existing;
    }
  } catch {
    // Fail-safe: generate new device id if unreadable
  }

  const created = Crypto.randomUUID();
  try {
    await storageSet(DEVICE_ID_KEY, created);
  } catch {
    // If device ID save fails, still return generated ID
  }
  runtimeNativeInstallationId = created;
  return created;
}

export function getCachedInstallationDeviceId(): string | null {
  return Platform.OS === 'web' ? runtimeWebInstallationId : runtimeNativeInstallationId;
}

export async function storeSession(session: CaptainSessionEnvelope): Promise<void> {
  const validated = validateCaptainSessionEnvelope(session);

  const targetGen = ++authGeneration;
  refreshInFlight = null;

  const value = refreshStateJson(validated);
  try {
    await storageSet(REFRESH_STATE_KEY, value);
  } catch (storageErr) {
    runtimeAccessToken = null;
    runtimeAccountId = null;
    throw storageErr;
  }

  if (authGeneration === targetGen) {
    runtimeAccessToken = validated.accessToken;
    runtimeAccountId = validated.accountId;
  }
}

export async function clearSession(): Promise<void> {
  ++authGeneration;
  runtimeAccessToken = null;
  runtimeAccountId = null;
  refreshInFlight = null;

  await storageDelete(REFRESH_STATE_KEY);
}

export async function getStoredRefreshState(): Promise<StoredRefreshState | null> {
  let raw: string | null = null;
  try {
    raw = await storageGet(REFRESH_STATE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.accountId === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      parsed.refreshToken.trim().length > 0 &&
      typeof parsed.refreshTokenExpiresAt === 'string'
    ) {
      return parsed as StoredRefreshState;
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshCaptainSession(): Promise<CaptainSessionEnvelope> {
  const capturedGeneration = authGeneration;

  if (refreshInFlight && refreshInFlight.authOperationGeneration === capturedGeneration) {
    return refreshInFlight.promise;
  }

  const refreshPromise = (async (): Promise<CaptainSessionEnvelope> => {
    const state = await getStoredRefreshState();
    if (!state) {
      if (capturedGeneration === authGeneration) {
        await clearSession();
      }
      throw AppError.fromHttp(401, {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'No active session found',
      });
    }

    let res: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    try {
      res = await fetch(`${getApiBaseUrl()}/api/v1/auth/sessions/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
        signal: controller.signal,
      });
    } catch (networkErr: any) {
      if (capturedGeneration !== authGeneration) {
        throw new AppError({
          kind: 'ValidationRejected',
          code: 'STALE_AUTH_GENERATION',
          message: 'Stale refresh failed after session state changed',
        });
      }
      if (networkErr?.name === 'AbortError') {
        throw AppError.timeout('Session refresh timed out');
      }
      throw AppError.network(networkErr?.message || 'Network error during session refresh');
    } finally {
      clearTimeout(timeoutId);
    }

    // Invariant A2 & A3: Stale refresh response must never resurrect or overwrite
    if (capturedGeneration !== authGeneration) {
      throw new AppError({
        kind: 'ValidationRejected',
        code: 'STALE_AUTH_GENERATION',
        message: 'Stale refresh completed after logout or new session establishment',
      });
    }

    if (!res.ok) {
      if (capturedGeneration === authGeneration) {
        if (res.status === 401 || res.status === 403) {
          await clearSession();
        }
      }
      throw AppError.fromHttp(res.status, {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Session refresh failed',
      });
    }

    let jsonBody: unknown;
    try {
      jsonBody = await res.json();
    } catch {
      if (capturedGeneration === authGeneration) {
        await clearSession();
      }
      throw new AppError({
        kind: 'ValidationRejected',
        code: 'MALFORMED_SESSION_PAYLOAD',
        message: 'Refresh response is not valid JSON',
      });
    }

    let validated: CaptainSessionEnvelope;
    try {
      validated = validateCaptainSessionEnvelope(jsonBody);
    } catch (valErr) {
      if (capturedGeneration === authGeneration) {
        await clearSession();
      }
      throw valErr;
    }

    if (validated.accountId !== state.accountId) {
      if (capturedGeneration === authGeneration) {
        await clearSession();
      }
      throw new AppError({
        kind: 'AuthenticationExpired',
        code: 'SESSION_ACCOUNT_MISMATCH',
        message: 'Session refresh returned credentials for a different account',
        status: 401,
      });
    }

    // Invariant A3: Verify generation again before persisting new tokens
    if (capturedGeneration !== authGeneration) {
      throw new AppError({
        kind: 'ValidationRejected',
        code: 'STALE_AUTH_GENERATION',
        message: 'Stale refresh completed after logout or new session establishment',
      });
    }

    const value = refreshStateJson(validated);
    try {
      await storageSet(REFRESH_STATE_KEY, value);
    } catch (storageErr) {
      if (capturedGeneration === authGeneration) {
        runtimeAccessToken = null;
      }
      throw new AppError({
        kind: 'ServerFailure',
        code: 'SECURE_STORAGE_ERROR',
        message: 'Failed to securely persist refreshed credentials',
      });
    }

    if (capturedGeneration === authGeneration) {
      runtimeAccessToken = validated.accessToken;
      runtimeAccountId = validated.accountId;
    }

    return validated;
  })();

  refreshInFlight = {
    tokenGeneration: 0,
    authOperationGeneration: capturedGeneration,
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

export function setRuntimeAccessTokenForTesting(
  token: string | null,
  accountId = 'captain-test-runtime',
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'ILLEGAL_INVOCATION',
      message: 'setRuntimeAccessTokenForTesting cannot be called outside test environment',
    });
  }
  runtimeAccessToken = token;
  runtimeAccountId = token ? accountId : null;
}
