import { isFreshOtp } from '@/auth/fresh-otp';

describe('fresh OTP authorization', () => {
  it('accepts recent verification and rejects restored or stale sessions', () => {
    expect(isFreshOtp(null, 10_000)).toBe(false);
    expect(isFreshOtp(9_000, 10_000, 2_000)).toBe(true);
    expect(isFreshOtp(7_000, 10_000, 2_000)).toBe(false);
  });
  it('rejects future timestamps', () => expect(isFreshOtp(11_000, 10_000, 2_000)).toBe(false));
});
