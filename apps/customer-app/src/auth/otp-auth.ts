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
  retryAfterSeconds: number;
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
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (value.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new OtpAuthError('INVALID_INPUT', 'Enter a valid mobile number.');
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
  code: string
): Promise<CustomerAuthSession> {
  const trimmedCode = code.trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new OtpAuthError('INVALID_INPUT', 'Enter the six-digit code.');
  }

  try {
    const response = await apiClient.post<CustomerAuthSession>('/api/v1/auth/otp/verify', {
      challengeId,
      mobile,
      purpose: 'LOGIN',
      code: trimmedCode,
    });
    return response;
  } catch (error) {
    throw normalizeOtpError(error);
  }
}

export async function resendOtpCode(mobile: string, deviceId: string): Promise<OtpChallengeResponse> {
  try {
    const response = await apiClient.post<OtpChallengeResponse>('/api/v1/auth/otp/request', {
      mobile,
      purpose: 'LOGIN',
      deviceId,
    });
    return response;
  } catch (error) {
    throw normalizeOtpError(error);
  }
}
