const mockSecureStorage = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStorage.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStorage.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStorage.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import * as SecureStore from "expo-secure-store";
import {
  assertMerchantEnvelope,
  hasRuntimeMerchantSession,
  logoutMerchant,
  merchantApiFetch,
  merchantVerifyPayload,
  restoreMerchantSession,
  verifyMerchantOtp,
  type MerchantSessionEnvelope,
} from "./session";

const REFRESH_STATE_KEY = "mypetnew.merchant.refresh.v1";

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function merchantSession(accessToken: string, refreshToken: string): MerchantSessionEnvelope {
  return {
    accountId: "account",
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    accessTokenExpiresAt: futureIso(60),
    refreshTokenExpiresAt: futureIso(60 * 24),
    role: "MERCHANT",
  };
}

function response(status: number, body: unknown = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

async function waitForFetchCalls(fetchMock: jest.Mock, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && fetchMock.mock.calls.length < expected; attempt += 1) {
    await Promise.resolve();
  }
  expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(expected);
}

describe("Merchant session contract", () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.mypet.test";
  });

  beforeEach(() => {
    mockSecureStorage.clear();
    jest.restoreAllMocks();
  });

  test("verification payload never accepts a client role", () => {
    const body = merchantVerifyPayload("challenge", "+919876543210", "123456");
    expect(body).toEqual({ challengeId: "challenge", mobile: "+919876543210", purpose: "LOGIN", code: "123456" });
    expect(body).not.toHaveProperty("role");
  });

  test("client fails closed on a non Merchant server session", () => {
    expect(() => assertMerchantEnvelope({
      ...merchantSession("access", "refresh"),
      role: "CUSTOMER",
    })).toThrow("Merchant session");
  });

  test("client accepts complete Merchant server session", () => {
    expect(assertMerchantEnvelope(merchantSession("access", "refresh")).role).toBe("MERCHANT");
  });

  test("staggered concurrent 401s reuse one rotated session instead of rotating twice", async () => {
    let resolveFirst401!: (value: Response) => void;
    let resolveSecond401!: (value: Response) => void;
    const first401 = new Promise<Response>((resolve) => { resolveFirst401 = resolve; });
    const second401 = new Promise<Response>((resolve) => { resolveSecond401 = resolve; });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(200, merchantSession("access-a", "refresh-a")))
      .mockImplementationOnce(() => first401)
      .mockImplementationOnce(() => second401)
      .mockResolvedValueOnce(response(200, merchantSession("access-b", "refresh-b")))
      .mockResolvedValueOnce(response(200, { ok: true }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyMerchantOtp("challenge", "+919876543210", "123456");
    const firstRequest = merchantApiFetch("/api/v1/merchant/orders");
    const secondRequest = merchantApiFetch("/api/v1/merchant/inventory");

    resolveFirst401(response(401, { code: "AUTHENTICATION_REQUIRED" }));
    await expect(firstRequest).resolves.toMatchObject({ status: 200 });

    resolveSecond401(response(401, { code: "AUTHENTICATION_REQUIRED" }));
    await expect(secondRequest).resolves.toMatchObject({ status: 200 });

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/v1/auth/sessions/refresh"));
    expect(refreshCalls).toHaveLength(1);

    const retryAuthorizationHeaders = fetchMock.mock.calls
      .slice(4)
      .map(([, init]) => (init as RequestInit).headers as Record<string, string>);
    expect(retryAuthorizationHeaders).toHaveLength(2);
    expect(retryAuthorizationHeaders.every((headers) => headers.Authorization === "Bearer access-b")).toBe(true);
  });

  test("offline sign out keeps the current session available for retry", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(200, merchantSession("access-c", "refresh-c")))
      .mockRejectedValueOnce(new TypeError("Network request failed"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyMerchantOtp("challenge-c", "+919876543210", "123456");
    expect(hasRuntimeMerchantSession()).toBe(true);
    expect(mockSecureStorage.get(REFRESH_STATE_KEY)).toContain("refresh-c");

    await expect(logoutMerchant()).rejects.toThrow("Network request failed");
    expect(hasRuntimeMerchantSession()).toBe(true);
    expect(mockSecureStorage.get(REFRESH_STATE_KEY)).toContain("refresh-c");

    globalThis.fetch = jest.fn().mockResolvedValue(response(204)) as unknown as typeof fetch;
    await logoutMerchant();
    expect(hasRuntimeMerchantSession()).toBe(false);
    expect(mockSecureStorage.has(REFRESH_STATE_KEY)).toBe(false);
  });

  test("transient restore failure preserves the persisted refresh credential", async () => {
    if (hasRuntimeMerchantSession()) {
      globalThis.fetch = jest.fn().mockResolvedValue(response(204)) as unknown as typeof fetch;
      await logoutMerchant();
    }
    const stored = {
      version: 1,
      accountId: "account",
      refreshToken: "refresh-retry",
      refreshTokenExpiresAt: futureIso(60),
    };
    mockSecureStorage.set(REFRESH_STATE_KEY, JSON.stringify(stored));
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch;

    await expect(restoreMerchantSession()).rejects.toThrow("Network request failed");
    expect(mockSecureStorage.get(REFRESH_STATE_KEY)).toContain("refresh-retry");
    expect(hasRuntimeMerchantSession()).toBe(false);
  });

  test("a stale refresh cannot overwrite a newer OTP login credential", async () => {
    if (hasRuntimeMerchantSession()) {
      globalThis.fetch = jest.fn().mockResolvedValue(response(204)) as unknown as typeof fetch;
      await logoutMerchant();
    }

    let resolveRefresh!: (value: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(200, merchantSession("access-old", "refresh-old")))
      .mockResolvedValueOnce(response(401, { code: "AUTHENTICATION_REQUIRED" }))
      .mockImplementationOnce(() => refreshResponse)
      .mockResolvedValueOnce(response(200, merchantSession("access-new", "refresh-new")))
      .mockResolvedValueOnce(response(200, { ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyMerchantOtp("challenge-old", "+919876543210", "123456");
    const staleProtectedRequest = merchantApiFetch("/api/v1/merchant/orders");
    await waitForFetchCalls(fetchMock, 3);

    let releaseLoginStorage!: () => void;
    let markLoginStorageStarted!: () => void;
    const loginStorageStarted = new Promise<void>((resolve) => { markLoginStorageStarted = resolve; });
    const loginStorageRelease = new Promise<void>((resolve) => { releaseLoginStorage = resolve; });
    const secureSet = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>;
    secureSet.mockImplementationOnce(async (key: string, value: string) => {
      markLoginStorageStarted();
      await loginStorageRelease;
      mockSecureStorage.set(key, value);
    });

    const newerLogin = verifyMerchantOtp("challenge-new", "+919876543210", "654321");
    await loginStorageStarted;
    resolveRefresh(response(200, merchantSession("access-refreshed-old", "refresh-refreshed-old")));
    releaseLoginStorage();

    await expect(newerLogin).resolves.toMatchObject({ accessToken: "access-new", refreshToken: "refresh-new" });
    await expect(staleProtectedRequest).rejects.toThrow("AUTH_SESSION_CHANGED");
    expect(mockSecureStorage.get(REFRESH_STATE_KEY)).toContain("refresh-new");
    expect(mockSecureStorage.get(REFRESH_STATE_KEY)).not.toContain("refresh-refreshed-old");

    await expect(merchantApiFetch("/api/v1/merchant/orders")).resolves.toMatchObject({ status: 200 });
    const lastCallHeaders = fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>;
    expect(lastCallHeaders.Authorization).toBe("Bearer access-new");
  });
});
