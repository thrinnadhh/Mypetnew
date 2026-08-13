jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn()
}));

jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { assertMerchantEnvelope, merchantVerifyPayload } from "./session";

describe("Merchant session contract", () => {
  test("verification payload never accepts a client role", () => {
    const body = merchantVerifyPayload("challenge", "+919876543210", "123456");
    expect(body).toEqual({ challengeId: "challenge", mobile: "+919876543210", purpose: "LOGIN", code: "123456" });
    expect(body).not.toHaveProperty("role");
  });

  test("client fails closed on a non Merchant server session", () => {
    expect(() => assertMerchantEnvelope({
      accountId: "account",
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      accessTokenExpiresAt: "2026-08-13T00:00:00Z",
      refreshTokenExpiresAt: "2026-09-13T00:00:00Z",
      role: "CUSTOMER"
    })).toThrow("Merchant session");
  });

  test("client accepts complete Merchant server session", () => {
    expect(assertMerchantEnvelope({
      accountId: "account",
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      accessTokenExpiresAt: "2026-08-13T00:00:00Z",
      refreshTokenExpiresAt: "2026-09-13T00:00:00Z",
      role: "MERCHANT"
    }).role).toBe("MERCHANT");
  });
});
