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

import {
  assertMerchantEnvelope,
  merchantApiFetch,
  merchantVerifyPayload,
  verifyMerchantOtp,
  type MerchantSessionEnvelope,
} from "./session";

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
    global.fetch = fetchMock as unknown as typeof fetch;

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
});
