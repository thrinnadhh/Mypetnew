import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type MerchantSessionEnvelope = {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  role: string;
};

type StoredRefreshState = {
  version: 1;
  accountId: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

type RefreshFlight = {
  tokenGeneration: number;
  authOperationGeneration: number;
  promise: Promise<MerchantSessionEnvelope>;
};

const REFRESH_STATE_KEY = "mypetnew.merchant.refresh.v1";
const DEVICE_ID_KEY = "mypetnew.merchant.installation.v1";
let runtimeAccessToken: string | null = null;
let accessTokenGeneration = 0;
let authOperationGeneration = 0;
let runtimeWebInstallationId: string | null = null;
let refreshInFlight: RefreshFlight | null = null;
let storageMutationTail: Promise<void> = Promise.resolve();

function baseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!raw) throw new Error("Merchant API configuration is missing");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Merchant API configuration is invalid");
  }
  const localDevHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "10.0.2.2";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localDevHost)) {
    throw new Error("Merchant API configuration must use HTTPS");
  }
  return raw.replace(/\/$/, "");
}

function serializeStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageMutationTail.then(operation, operation);
  storageMutationTail = next.then(() => undefined, () => undefined);
  return next;
}

async function storageGet(key: string): Promise<string | null> {
  // Version 1 Merchant is a native Expo app. Never persist refresh secrets in browser storage.
  if (Platform.OS === "web") return null;
  await storageMutationTail;
  return SecureStore.getItemAsync(key);
}

function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return serializeStorageMutation(() => SecureStore.setItemAsync(key, value));
}

function storageDelete(key: string): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return serializeStorageMutation(() => SecureStore.deleteItemAsync(key));
}

function refreshStateJson(session: MerchantSessionEnvelope): string {
  const state: StoredRefreshState = {
    version: 1,
    accountId: session.accountId,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  };
  return JSON.stringify(state);
}

async function writeRefreshStateDirect(value: string): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(REFRESH_STATE_KEY, value);
}

async function deleteRefreshStateDirect(): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(REFRESH_STATE_KEY);
}

async function commitLoginSession(session: MerchantSessionEnvelope, expectedAuthOperation: number): Promise<void> {
  const value = refreshStateJson(session);
  await serializeStorageMutation(async () => {
    if (authOperationGeneration !== expectedAuthOperation) throw new Error("AUTH_SESSION_CHANGED");
    try {
      await writeRefreshStateDirect(value);
    } catch (error) {
      // Never expose a runtime access token when the rotated refresh secret could not be stored.
      runtimeAccessToken = null;
      throw error;
    }
    // A newer login/logout intent can begin while native secure storage is awaiting completion.
    // Delete this now-stale credential before releasing the serialized queue.
    if (authOperationGeneration !== expectedAuthOperation) {
      runtimeAccessToken = null;
      await deleteRefreshStateDirect().catch(() => undefined);
      throw new Error("AUTH_SESSION_CHANGED");
    }
    runtimeAccessToken = session.accessToken;
    accessTokenGeneration += 1;
  });
}

async function commitRefreshedSession(
  session: MerchantSessionEnvelope,
  expectedTokenGeneration: number,
  expectedAuthOperation: number,
): Promise<boolean> {
  const value = refreshStateJson(session);
  return serializeStorageMutation(async () => {
    if (
      accessTokenGeneration !== expectedTokenGeneration ||
      authOperationGeneration !== expectedAuthOperation
    ) {
      return false;
    }
    try {
      await writeRefreshStateDirect(value);
    } catch (error) {
      // The server already rotated the refresh session. The old runtime/storage credentials must
      // fail closed because they can no longer be trusted to be usable.
      runtimeAccessToken = null;
      accessTokenGeneration += 1;
      await deleteRefreshStateDirect().catch(() => undefined);
      throw error;
    }
    if (
      accessTokenGeneration !== expectedTokenGeneration ||
      authOperationGeneration !== expectedAuthOperation
    ) {
      runtimeAccessToken = null;
      await deleteRefreshStateDirect().catch(() => undefined);
      return false;
    }
    runtimeAccessToken = session.accessToken;
    accessTokenGeneration += 1;
    return true;
  });
}

async function clearRefreshStateForGeneration(
  expectedTokenGeneration: number,
  expectedAuthOperation: number,
): Promise<void> {
  await serializeStorageMutation(async () => {
    if (
      accessTokenGeneration !== expectedTokenGeneration ||
      authOperationGeneration !== expectedAuthOperation
    ) {
      return;
    }
    runtimeAccessToken = null;
    accessTokenGeneration += 1;
    await deleteRefreshStateDirect().catch(() => undefined);
  });
}

async function clearLocalSessionForAuthOperation(expectedAuthOperation: number): Promise<void> {
  await serializeStorageMutation(async () => {
    if (authOperationGeneration !== expectedAuthOperation) return;
    runtimeAccessToken = null;
    accessTokenGeneration += 1;
    await deleteRefreshStateDirect();
  });
}

export function merchantVerifyPayload(challengeId: string, mobile: string, code: string) {
  return { challengeId, mobile, purpose: "LOGIN" as const, code };
}

export function assertMerchantEnvelope(value: MerchantSessionEnvelope): MerchantSessionEnvelope {
  if (value.role !== "MERCHANT") throw new Error("The server did not issue a Merchant session");
  if (!value.accessToken || !value.refreshToken || !value.accountId || value.tokenType !== "Bearer") {
    throw new Error("The Merchant session response is incomplete");
  }
  const accessExpiry = Date.parse(value.accessTokenExpiresAt);
  const refreshExpiry = Date.parse(value.refreshTokenExpiresAt);
  if (!Number.isFinite(accessExpiry) || !Number.isFinite(refreshExpiry) || refreshExpiry <= Date.now()) {
    throw new Error("The Merchant session response is incomplete");
  }
  return value;
}

async function loadRefreshState(): Promise<StoredRefreshState | null> {
  const raw = await storageGet(REFRESH_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRefreshState>;
    if (
      parsed.version !== 1 ||
      typeof parsed.accountId !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.refreshTokenExpiresAt !== "string"
    ) {
      await storageDelete(REFRESH_STATE_KEY);
      return null;
    }
    const expiry = Date.parse(parsed.refreshTokenExpiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      await storageDelete(REFRESH_STATE_KEY);
      return null;
    }
    return parsed as StoredRefreshState;
  } catch {
    await storageDelete(REFRESH_STATE_KEY);
    return null;
  }
}

export async function installationId(): Promise<string> {
  if (Platform.OS === "web") {
    runtimeWebInstallationId ??= Crypto.randomUUID();
    return runtimeWebInstallationId;
  }
  const existing = await storageGet(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await storageSet(DEVICE_ID_KEY, created);
  return created;
}

async function jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body && typeof body === "object" && "code" in body ? String(body.code) : `HTTP_${response.status}`;
    throw new Error(code);
  }
  return body as T;
}

export async function requestMerchantOtp(mobile: string) {
  return jsonRequest<{ challengeId: string; message: string; expiresAt: string; resendAfterSeconds: number }>(
    "/api/v1/auth/otp/request",
    {
      method: "POST",
      body: JSON.stringify({ mobile, purpose: "LOGIN", deviceId: await installationId() }),
    },
  );
}

export async function verifyMerchantOtp(challengeId: string, mobile: string, code: string) {
  const authOperation = ++authOperationGeneration;
  const session = assertMerchantEnvelope(
    await jsonRequest<MerchantSessionEnvelope>("/api/v1/auth/merchant/otp/verify", {
      method: "POST",
      body: JSON.stringify(merchantVerifyPayload(challengeId, mobile, code)),
    }),
  );
  await commitLoginSession(session, authOperation);
  return session;
}

function isTerminalRefreshError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "REFRESH_TOKEN_INVALID" ||
    error.message === "AUTHENTICATION_REQUIRED" ||
    error.message === "SESSION_INVALID" ||
    /Merchant session|session response is incomplete/i.test(error.message)
  );
}

async function rotateRefreshToken(): Promise<MerchantSessionEnvelope> {
  const tokenGenerationAtStart = accessTokenGeneration;
  const authOperationAtStart = authOperationGeneration;
  if (
    refreshInFlight?.tokenGeneration === tokenGenerationAtStart &&
    refreshInFlight.authOperationGeneration === authOperationAtStart
  ) {
    return refreshInFlight.promise;
  }

  const promise = (async () => {
    const stored = await loadRefreshState();
    if (!stored) throw new Error("AUTHENTICATION_REQUIRED");
    const session = assertMerchantEnvelope(
      await jsonRequest<MerchantSessionEnvelope>("/api/v1/auth/sessions/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      }),
    );
    const committed = await commitRefreshedSession(
      session,
      tokenGenerationAtStart,
      authOperationAtStart,
    );
    if (!committed) throw new Error("AUTH_SESSION_CHANGED");
    return session;
  })();
  refreshInFlight = {
    tokenGeneration: tokenGenerationAtStart,
    authOperationGeneration: authOperationAtStart,
    promise,
  };

  try {
    return await promise;
  } catch (error) {
    // Network/provider/server failures are retryable and must not erase a still-valid persisted
    // refresh credential. Only a definitive auth/session rejection clears this exact generation.
    if (isTerminalRefreshError(error)) {
      await clearRefreshStateForGeneration(tokenGenerationAtStart, authOperationAtStart);
    }
    throw error;
  } finally {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  }
}

export async function restoreMerchantSession(): Promise<MerchantSessionEnvelope | null> {
  const stored = await loadRefreshState();
  if (!stored) return null;
  return rotateRefreshToken();
}

function requireRuntimeAccessToken(): string {
  if (!runtimeAccessToken) throw new Error("AUTHENTICATION_REQUIRED");
  return runtimeAccessToken;
}

export async function merchantApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!runtimeAccessToken) await rotateRefreshToken();
  const tokenUsed = requireRuntimeAccessToken();
  const generationUsed = accessTokenGeneration;
  const execute = (token: string) =>
    fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let response = await execute(tokenUsed);
  if (response.status === 401 && !path.startsWith("/api/v1/auth/")) {
    // If another request already refreshed this stale token, reuse the newer token instead of
    // rotating again and revoking the session that the first retry is using.
    if (accessTokenGeneration === generationUsed && runtimeAccessToken === tokenUsed) {
      await rotateRefreshToken();
    }
    response = await execute(requireRuntimeAccessToken());
  }
  return response;
}

async function revokeCurrentSession(expectedAuthOperation: number): Promise<void> {
  if (authOperationGeneration !== expectedAuthOperation) throw new Error("AUTH_SESSION_CHANGED");
  if (!runtimeAccessToken) {
    await rotateRefreshToken();
  }
  if (authOperationGeneration !== expectedAuthOperation) throw new Error("AUTH_SESSION_CHANGED");
  const token = requireRuntimeAccessToken();
  let response = await fetch(`${baseUrl()}/api/v1/auth/sessions/current`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (response.status === 401) {
    if (authOperationGeneration !== expectedAuthOperation) throw new Error("AUTH_SESSION_CHANGED");
    await rotateRefreshToken();
    if (authOperationGeneration !== expectedAuthOperation) throw new Error("AUTH_SESSION_CHANGED");
    const refreshedToken = requireRuntimeAccessToken();
    response = await fetch(`${baseUrl()}/api/v1/auth/sessions/current`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${refreshedToken}`, Accept: "application/json" },
    });
  }
  if (!response.ok && response.status !== 401) {
    throw new Error(`HTTP_${response.status}`);
  }
}

export async function logoutMerchant(): Promise<void> {
  const authOperation = ++authOperationGeneration;
  const stored = await loadRefreshState();
  if (runtimeAccessToken || stored) {
    try {
      await revokeCurrentSession(authOperation);
    } catch (error) {
      if (isTerminalRefreshError(error)) {
        await clearLocalSessionForAuthOperation(authOperation);
        return;
      }
      throw error;
    }
  }
  await clearLocalSessionForAuthOperation(authOperation);
}

export function hasRuntimeMerchantSession(): boolean {
  return runtimeAccessToken !== null;
}

export async function bypassMerchantLoginForDemo(): Promise<MerchantSessionEnvelope> {
  const demoSession: MerchantSessionEnvelope = {
    accountId: 'merchant-demo-account',
    accessToken: 'demo-merchant-token',
    refreshToken: 'demo-merchant-refresh-token',
    tokenType: 'Bearer',
    accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    role: 'MERCHANT',
  };
  runtimeAccessToken = demoSession.accessToken;
  accessTokenGeneration += 1;
  return demoSession;
}

