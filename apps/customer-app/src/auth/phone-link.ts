import { normalizeOtpError, normalizePhone, OtpAuthError } from '@/auth/otp-auth';
import { supabase } from '@/utils/supabase';

export async function requestPhoneLink(rawPhone: string): Promise<string> {
  const phone = normalizePhone(rawPhone);
  const { error } = await supabase.auth.updateUser({ phone });
  if (error) throw normalizeOtpError(error);
  return phone;
}

export async function verifyPhoneLink(phone: string, rawToken: string) {
  const token = rawToken.trim();
  if (!/^\d{6}$/.test(token)) {
    throw new OtpAuthError('INVALID_INPUT', 'Enter the six-digit code.');
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'phone_change',
  });
  if (error) throw normalizeOtpError(error);

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw normalizeOtpError(refreshed.error);
  if (!refreshed.data.session) {
    throw new OtpAuthError('UNKNOWN', 'The verified mobile could not be attached to your account.');
  }
  return refreshed.data.session;
}
