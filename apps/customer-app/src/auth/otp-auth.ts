import type { AuthError } from '@supabase/supabase-js';

import { supabase } from '@/utils/supabase';

export type OtpChannel = 'phone' | 'email';
export type OtpErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CODE'
  | 'EXPIRED_CODE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'PROVIDER_UNAVAILABLE'
  | 'CANCELLED'
  | 'UNKNOWN';

export class OtpAuthError extends Error {
  constructor(public readonly code: OtpErrorCode, message: string) {
    super(message);
  }
}

export function normalizeOtpError(error: unknown): OtpAuthError {
  if (error instanceof OtpAuthError) return error;
  const authError = error as (Partial<AuthError> & { code?: string }) | undefined;
  const message = authError?.message?.toLowerCase() ?? '';
  const providerCode = authError?.code?.toLowerCase() ?? '';
  const status = authError?.status;

  if (
    providerCode === 'phone_provider_disabled' ||
    message.includes('unsupported phone provider') ||
    message.includes('phone provider disabled')
  ) {
    return new OtpAuthError('PROVIDER_UNAVAILABLE', 'Mobile verification is temporarily unavailable.');
  }
  if (
    providerCode === 'email_address_invalid' ||
    (message.includes('email address') && message.includes('invalid'))
  ) {
    return new OtpAuthError('INVALID_INPUT', 'Enter a valid email address.');
  }
  if (status === 429 || message.includes('rate') || message.includes('too many')) {
    return new OtpAuthError('RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  if (message.includes('expired')) {
    return new OtpAuthError('EXPIRED_CODE', 'This code has expired. Request a new code.');
  }
  if (message.includes('invalid') || message.includes('token')) {
    return new OtpAuthError('INVALID_CODE', 'The code is invalid. Check it and try again.');
  }
  if (message.includes('network') || message.includes('fetch')) {
    return new OtpAuthError('NETWORK', 'Network unavailable. Check your connection and retry.');
  }
  return new OtpAuthError('UNKNOWN', authError?.message ?? 'Authentication could not be completed.');
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (value.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new OtpAuthError('INVALID_INPUT', 'Enter a valid mobile number.');
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OtpAuthError('INVALID_INPUT', 'Enter a valid email address.');
  }
  return email;
}

export async function sendOtp(channel: OtpChannel, rawIdentifier: string): Promise<string> {
  const identifier = channel === 'phone' ? normalizePhone(rawIdentifier) : normalizeEmail(rawIdentifier);
  const result = channel === 'phone'
    ? await supabase.auth.signInWithOtp({ phone: identifier, options: { shouldCreateUser: true, data: { role: 'CUSTOMER' } } })
    : await supabase.auth.signInWithOtp({ email: identifier, options: { shouldCreateUser: true, data: { role: 'CUSTOMER' } } });
  if (result.error) throw normalizeOtpError(result.error);
  return identifier;
}

export async function verifyOtp(channel: OtpChannel, identifier: string, token: string) {
  if (!/^\d{6}$/.test(token.trim())) throw new OtpAuthError('INVALID_INPUT', 'Enter the six-digit code.');
  const result = channel === 'phone'
    ? await supabase.auth.verifyOtp({ phone: identifier, token: token.trim(), type: 'sms' })
    : await supabase.auth.verifyOtp({ email: identifier, token: token.trim(), type: 'email' });
  if (result.error) throw normalizeOtpError(result.error);
  if (!result.data.session) throw new OtpAuthError('UNKNOWN', 'The session could not be created.');
  return result.data.session;
}

export async function resendOtp(channel: OtpChannel, identifier: string) {
  const result = channel === 'phone'
    ? await supabase.auth.resend({ type: 'sms', phone: identifier })
    : await supabase.auth.signInWithOtp({ email: identifier, options: { shouldCreateUser: true, data: { role: 'CUSTOMER' } } });
  if (result.error) throw normalizeOtpError(result.error);
}
