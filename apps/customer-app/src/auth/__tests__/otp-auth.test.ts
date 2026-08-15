import { ApiError, apiClient } from '@/services/api-client';
import {
  normalizeOtpError,
  normalizePhone,
  OtpAuthError,
  requestOtp,
  resendOtpCode,
  validateServerRole,
  verifyOtpCode,
} from '@/auth/otp-auth';

jest.mock('@/services/api-client', () => {
  const original = jest.requireActual('@/services/api-client');
  return {
    ...original,
    apiClient: {
      post: jest.fn(),
    },
  };
});

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

describe('MyPetNew OTP authentication service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes only Indian mobile formats accepted by the backend', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(() => normalizePhone('+1 (415) 555-2671')).toThrow('valid Indian mobile number');
    expect(() => normalizePhone('5876543210')).toThrow('valid Indian mobile number');
    expect(() => normalizePhone('1234')).toThrow('valid Indian mobile number');
  });

  it('requests OTP challenge via MyPetNew identity endpoint returning canonical resendAfterSeconds', async () => {
    mockPost.mockResolvedValueOnce({
      challengeId: 'challenge-123',
      expiresAt: '2026-08-12T19:00:00Z',
      resendAfterSeconds: 30,
    });

    const result = await requestOtp('9876543210', 'device-uuid-1');

    expect(result.mobile).toBe('+919876543210');
    expect(result.challenge).toEqual({
      challengeId: 'challenge-123',
      expiresAt: '2026-08-12T19:00:00Z',
      resendAfterSeconds: 30,
    });
    expect(mockPost).toHaveBeenCalledWith('/api/v1/auth/otp/request', {
      mobile: '+919876543210',
      purpose: 'LOGIN',
      deviceId: 'device-uuid-1',
    });
  });

  it('verifies 6-digit OTP code and combines server session with verified mobile', async () => {
    const mockServerResponse = {
      accountId: 'acc-uuid-1',
      accessToken: 'access-jwt',
      refreshToken: 'refresh-jwt',
      tokenType: 'Bearer',
      accessTokenExpiresAt: '2026-08-12T19:00:00Z',
      refreshTokenExpiresAt: '2026-09-11T18:00:00Z',
      role: 'CUSTOMER',
    };
    mockPost.mockResolvedValueOnce(mockServerResponse);

    const session = await verifyOtpCode('challenge-123', '+919876543210', ' 123456 ', true);

    expect(session).toEqual({
      ...mockServerResponse,
      mobile: '+919876543210',
    });
    expect(session.mobile).toBe('+919876543210');
    expect(mockPost).toHaveBeenCalledWith('/api/v1/auth/otp/verify', {
      challengeId: 'challenge-123',
      mobile: '+919876543210',
      purpose: 'LOGIN',
      code: '123456',
      adultEligibilityAttested: true,
    });
  });

  it('strictly validates server role and rejects non-CUSTOMER roles', () => {
    expect(validateServerRole('CUSTOMER')).toBe('CUSTOMER');
    expect(() => validateServerRole('MERCHANT')).toThrow(ApiError);
    expect(() => validateServerRole('CAPTAIN')).toThrow(ApiError);
    expect(() => validateServerRole('ADMIN')).toThrow(ApiError);
    expect(() => validateServerRole('UNKNOWN')).toThrow(ApiError);
    expect(() => validateServerRole(undefined)).toThrow(ApiError);
  });

  it('rejects OTP verification if backend returns non-CUSTOMER role', async () => {
    mockPost.mockResolvedValueOnce({
      accountId: 'acc-uuid-1',
      accessToken: 'access-jwt',
      refreshToken: 'refresh-jwt',
      tokenType: 'Bearer',
      accessTokenExpiresAt: '2026-08-12T19:00:00Z',
      refreshTokenExpiresAt: '2026-09-11T18:00:00Z',
      role: 'MERCHANT',
    });

    await expect(verifyOtpCode('challenge-123', '+919876543210', '123456', true)).rejects.toThrow();
  });

  it('rejects invalid OTP formats before making network calls', async () => {
    await expect(verifyOtpCode('challenge-123', '+919876543210', '123', true)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('resends OTP challenge using same normalized mobile and deviceId', async () => {
    mockPost.mockResolvedValueOnce({
      challengeId: 'challenge-456',
      expiresAt: '2026-08-12T19:05:00Z',
      resendAfterSeconds: 45,
    });

    const result = await resendOtpCode('+91 98765 43210', 'device-uuid-1');

    expect(result).toEqual({
      challengeId: 'challenge-456',
      expiresAt: '2026-08-12T19:05:00Z',
      resendAfterSeconds: 45,
    });
    expect(mockPost).toHaveBeenCalledWith('/api/v1/auth/otp/request', {
      mobile: '+919876543210',
      purpose: 'LOGIN',
      deviceId: 'device-uuid-1',
    });
  });

  it('maps backend ApiError envelopes into stable UI OtpAuthError categories', () => {
    const invalidCodeErr = new ApiError(400, { code: 'OTP_INVALID', message: 'The OTP code is invalid', fieldErrors: {} });
    expect(normalizeOtpError(invalidCodeErr)).toMatchObject({
      code: 'INVALID_CODE',
      message: 'The code is invalid. Check it and try again.',
    });

    const expiredErr = new ApiError(400, { code: 'OTP_EXPIRED', message: 'The OTP has expired', fieldErrors: {} });
    expect(normalizeOtpError(expiredErr)).toMatchObject({
      code: 'EXPIRED_CODE',
      message: 'This code has expired. Request a new code.',
    });

    const replayedErr = new ApiError(400, { code: 'OTP_REPLAYED', message: 'The OTP has already been used', fieldErrors: {} });
    expect(normalizeOtpError(replayedErr)).toMatchObject({
      code: 'EXPIRED_CODE',
      message: 'This code has already been used. Request a new code.',
    });

    const rateLimitErr = new ApiError(429, { code: 'RATE_LIMITED', message: 'Rate limit exceeded', fieldErrors: {} });
    expect(normalizeOtpError(rateLimitErr)).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again later.',
    });

    const authReqErr = new ApiError(401, { code: 'AUTHENTICATION_REQUIRED', message: 'Auth required', fieldErrors: {} });
    expect(normalizeOtpError(authReqErr)).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });

    const providerErr = new ApiError(503, { code: 'PROVIDER_UNAVAILABLE', message: 'Service unavailable', fieldErrors: {} });
    expect(normalizeOtpError(providerErr)).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('maps network failures to NETWORK code', () => {
    const netErr = new TypeError('Failed to fetch');
    expect(normalizeOtpError(netErr)).toMatchObject({
      code: 'NETWORK',
      message: 'Network unavailable. Check your connection and retry.',
    });
  });

  it('preserves existing OtpAuthError instances', () => {
    const customErr = new OtpAuthError('CANCELLED', 'User cancelled');
    expect(normalizeOtpError(customErr)).toBe(customErr);
  });
});
