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

const REFRESH_STATE_KEY = "mypetnew.merchant.refresh.v1";
const DEVICE_ID_KEY = "mypetnew.merchant.installation.v1";
let runtimeAccessToken: string | null = null;
let runtimeWebInstallationId: string | null = null;
let refreshInFlight: Promise<MerchantSessionEnvelope> | null = null;

function baseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!raw) throw new Error("Merchant API configuration is missing");
  return raw.replace(/\/$/, "");
}

async function storageGet(key: string): Promise<string | null> {
  // Version 1 Merchant is a native Expo app. Never persist refresh secrets in browser storage.
  if (Platform.OS === "web") return null;
  return SecureStore.getItemAsync(key);
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(key, value);
}

async function storageDelete(key: string): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(key);
}

export function merchantVerifyPayload(challengeId: string, mobile: string, code: string) {
  return { challengeId, mobile, purpose: "LOGIN" as const, code };
}

export function assertMerchantEnvelope(value: MerchantSessionEnvelope): MerchantSessionEnvelope {
  if (value.role !== "MERCHANT") throw new Error("The server did not issue a Merchant session");
  if (!value.accessToken || !value.refreshToken || !value.accountId) {
    throw new Error("The Merchant session response is incomplete");
  }
  if (!value.accessTokenExpiresAt || !value.refreshTokenExpiresAt) {
    throw new Error("The Merchant session response is incomplete");
  }
  return value;
}

async function saveRefreshState(session: MerchantSessionEnvelope): Promise<void> {
  const state: StoredRefreshState = {
    version: 1,
    accountId: session.accountId,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  };
  await storageSet(REFRESH_STATE_KEY, JSON.stringify(state));
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
    if (Date.parse(parsed.refreshTokenExpiresAt) <= Date.now()) {
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
  const session = assertMerchantEnvelope(
    await jsonRequest<MerchantSessionEnvelope>("/api/v1/auth/merchant/otp/verify", {
      method: "POST",
      body: JSON.stringify(merchantVerifyPayload(challengeId, mobile, code)),
    }),
  );
  runtimeAccessToken = session.accessToken;
  await saveRefreshState(session);
  return session;
}

async function rotateRefreshToken(): Promise<MerchantSessionEnvelope> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const stored = await loadRefreshState();
    if (!stored) throw new Error("AUTHENTICATION_REQUIRED");
    const session = assertMerchantEnvelope(
      await jsonRequest<MerchantSessionEnvelope>("/api/v1/auth/sessions/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      }),
    );
    runtimeAccessToken = session.accessToken;
    await saveRefreshState(session);
    return session;
  })();
  try {
    return await refreshInFlight;
  } catch (error) {
    runtimeAccessToken = null;
    await storageDelete(REFRESH_STATE_KEY);
    throw error;
  } finally {
    refreshInFlight = null;
  }
}

export async function restoreMerchantSession(): Promise<MerchantSessionEnvelope | null> {
  const stored = await loadRefreshState();
  if (!stored) return null;
  return rotateRefreshToken();
}

export async function merchantApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!runtimeAccessToken) await rotateRefreshToken();
  const execute = () =>
    fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
        Authorization: `Bearer ${runtimeAccessToken}`,
      },
    });

  let response = await execute();
  if (response.status === 401 && !path.startsWith("/api/v1/auth/")) {
    await rotateRefreshToken();
    response = await execute();
  }
  return response;
}

export async function logoutMerchant(): Promise<void> {
  try {
    if (runtimeAccessToken) {
      await fetch(`${baseUrl()}/api/v1/auth/sessions/current`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${runtimeAccessToken}`, Accept: "application/json" },
      });
    }
  } finally {
    runtimeAccessToken = null;
    await storageDelete(REFRESH_STATE_KEY);
  }
}

export function hasRuntimeMerchantSession(): boolean {
  return runtimeAccessToken !== null;
}
