const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockResend = jest.fn();
jest.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      resend: (...args: unknown[]) => mockResend(...args),
    },
  },
}));

import {
  normalizeEmail,
  normalizeOtpError,
  normalizePhone,
  OtpAuthError,
  resendOtp,
  sendOtp,
  verifyOtp,
} from '@/auth/otp-auth';

describe('OTP authentication', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalizes supported Indian and international mobile formats', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-2671')).toBe('+14155552671');
    expect(() => normalizePhone('1234')).toThrow('valid mobile number');
  });

  it('normalizes email and rejects malformed input', () => {
    expect(normalizeEmail(' USER@Example.com ')).toBe('user@example.com');
    expect(() => normalizeEmail('invalid-address')).toThrow('valid email address');
  });

  it('sends and verifies mobile OTP', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    mockVerifyOtp.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
    const phone = await sendOtp('phone', '9876543210');
    await expect(verifyOtp('phone', phone, ' 123456 ')).resolves.toBeTruthy();
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      phone: '+919876543210',
      options: { shouldCreateUser: true, data: { role: 'CUSTOMER' } },
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      phone: '+919876543210', token: '123456', type: 'sms',
    });
  });

  it('supports email send, verify and resend', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    mockVerifyOtp.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } }, error: null });
    const email = await sendOtp('email', 'user@example.com');
    await expect(verifyOtp('email', email, '654321')).resolves.toBeTruthy();
    await resendOtp('email', email);
    expect(mockVerifyOtp).toHaveBeenCalledWith({ email, token: '654321', type: 'email' });
    expect(mockSignInWithOtp).toHaveBeenLastCalledWith({
      email,
      options: { shouldCreateUser: true, data: { role: 'CUSTOMER' } },
    });
  });

  it('resends mobile OTP through the dedicated SMS endpoint', async () => {
    mockResend.mockResolvedValue({ error: null });
    await expect(resendOtp('phone', '+919876543210')).resolves.toBeUndefined();
    expect(mockResend).toHaveBeenCalledWith({ type: 'sms', phone: '+919876543210' });
  });

  it('rejects malformed OTPs and missing sessions', async () => {
    await expect(verifyOtp('phone', '+919876543210', '123')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    mockVerifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(verifyOtp('phone', '+919876543210', '123456')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });

  it('normalizes send, verify and resend provider failures', async () => {
    mockSignInWithOtp.mockResolvedValueOnce({ error: { message: 'too many requests', status: 429 } });
    await expect(sendOtp('email', 'user@example.com')).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    mockVerifyOtp.mockResolvedValueOnce({ data: {}, error: { message: 'token expired', status: 400 } });
    await expect(verifyOtp('email', 'user@example.com', '123456')).rejects.toMatchObject({
      code: 'EXPIRED_CODE',
    });

    mockResend.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    await expect(resendOtp('phone', '+919876543210')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it.each([
    [{ status: 429, message: 'rate limit' }, 'RATE_LIMITED'],
    [{ status: 400, message: 'token expired' }, 'EXPIRED_CODE'],
    [{ status: 400, message: 'invalid token' }, 'INVALID_CODE'],
    [{ message: 'Failed to fetch' }, 'NETWORK'],
    [{ message: 'unexpected provider problem' }, 'UNKNOWN'],
  ])('normalizes Supabase failure %o', (error, code) => {
    expect(normalizeOtpError(error).code).toBe(code);
  });

  it('preserves already normalized OTP errors and uses the generic fallback', () => {
    const existing = new OtpAuthError('CANCELLED', 'Cancelled');
    expect(normalizeOtpError(existing)).toBe(existing);
    expect(normalizeOtpError(undefined)).toMatchObject({
      code: 'UNKNOWN', message: 'Authentication could not be completed.',
    });
  });
});
