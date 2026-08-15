import { ApiError, apiClient } from '@/services/api-client';
import type { CustomerAuthSession } from './types';

export type OtpErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CODE'
  | 'EXPIRED_CODE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'PROVIDER_UNAVAILABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'CANCELLED'
  | 'UNKNOWN';

export class OtpAuthError extends Error {
  constructor(public readonly code: OtpErrorCode, message: string) {
    super(message);
  }
}

export interface OtpChallengeResponse {
  challengeId: string;
  expiresAt: string;
  resendAfterSeconds: number;
}

export interface OtpSessionResponse {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  role: string;
}

export function validateServerRole(role: unknown): 'CUSTOMER' {
  if (role === 'CUSTOMER') return 'CUSTOMER';

  throw new ApiError(403, {
    code: 'AUTHORIZATION_REQUIRED',
    message: `Access denied for role '${String(role)}'. Customer application requires CUSTOMER role.`,
    fieldErrors: {},
  });
}

export function normalizeOtpError(error: unknown): OtpAuthError {
  if (error instanceof OtpAuthError) return error;

  if (error instanceof ApiError) {
    const code = error.code ? String(error.code).toUpperCase() : '';
    const status = error.status;

    if (code === 'OTP_PURPOSE_INVALID' || code === 'MOBILE_INVALID' || code === 'INVALID_INPUT') {
      return new OtpAuthError('INVALID_INPUT', 'Enter a valid mobile number.');
    }
    if (code === 'OTP_EXPIRED') {
      return new OtpAuthError('EXPIRED_CODE', 'This code has expired. Request a new code.');
    }
    if (code === 'OTP_INVALID' || code === 'OTP_NOT_FOUND') {
      return new OtpAuthError('INVALID_CODE', 'The code is invalid. Check it and try again.');
    }
    if (code === 'OTP_REPLAYED' || code === 'OTP_ALREADY_USED') {
      return new OtpAuthError('EXPIRED_CODE', 'This code has already been used. Request a new code.');
    }
    if (code === 'RATE_LIMITED' || code === 'ATTEMPT_EXHAUSTED' || status === 429) {
      return new OtpAuthError('RATE_LIMITED', 'Too many attempts. Try again later.');
    }
    if (status === 401 || code === 'AUTHENTICATION_REQUIRED') {
      return new OtpAuthError('AUTHENTICATION_REQUIRED', 'Authentication is required.');
    }
    if (status === 503 || code === 'PROVIDER_UNAVAILABLE') {
      return new OtpAuthError('PROVIDER_UNAVAILABLE', 'Mobile verification is temporarily unavailable.');
    }
    return new OtpAuthError('UNKNOWN', error.message || 'Authentication could not be completed.');
  }

  const errMessage = String((error as { message?: string })?.message ?? '').toLowerCase();
  if (errMessage.includes('network') || errMessage.includes('fetch')) {
    return new OtpAuthError('NETWORK', 'Network unavailable. Check your connection and retry.');
  }

  return new OtpAuthError('UNKNOWN', (error as Error)?.message || 'Authentication could not be completed.');
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const localDigits = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;

  if (localDigits.length === 10 && /^[6-9][0-9]{9}$/.test(localDigits)) {
    return `+91${localDigits}`;
  }

  throw new OtpAuthError('INVALID_INPUT', 'Enter a valid Indian mobile number.');
}

export async function requestOtp(mobile: string, deviceId: string): Promise<{ mobile: string; challenge: OtpChallengeResponse }> {
  try {
    const normalizedMobile = normalizePhone(mobile);
    const response = await apiClient.post<OtpChallengeResponse>('/api/v1/auth/otp/request', {
      mobile: normalizedMobile,
      purpose: 'LOGIN',
      deviceId,
    });
    return { mobile: normalizedMobile, challenge: response };
  } catch (error) {
    throw normalizeOtpError(error);
  }
}

export async function verifyOtpCode(
  challengeId: string,
  mobile: string,
  code: string,
  adultEligibilityAttested: boolean,
): Promise<CustomerAuthSession> {
  const normalizedMobile = normalizePhone(mobile);
  const trimmedCode = code.trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new OtpAuthError('INVALID_INPUT', 'Enter the six-digit code.');
  }
  if (!adultEligibilityAttested) {
    throw new OtpAuthError('INVALID_INPUT', 'Confirm that you are at least 18 years old.');
  }

  try {
    const response = await apiClient.post<OtpSessionResponse>('/api/v1/auth/otp/verify', {
      challengeId,
      mobile: normalizedMobile,
      purpose: 'LOGIN',
      code: trimmedCode,
      adultEligibilityAttested: true,
    });
    const role = validateServerRole(response.role);
    return {
      accountId: response.accountId,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      tokenType: response.tokenType || 'Bearer',
      accessTokenExpiresAt: response.accessTokenExpiresAt,
      refreshTokenExpiresAt: response.refreshTokenExpiresAt,
      role,
      mobile: normalizedMobile,
    };
  } catch (error) {
    throw normalizeOtpError(error);
  }
}

export async function resendOtpCode(mobile: string, deviceId: string): Promise<OtpChallengeResponse> {
  try {
    const normalizedMobile = normalizePhone(mobile);
    return await apiClient.post<OtpChallengeResponse>('/api/v1/auth/otp/request', {
      mobile: normalizedMobile,
      purpose: 'LOGIN',
      deviceId,
    });
  } catch (error) {
    throw normalizeOtpError(error);
  }
}
