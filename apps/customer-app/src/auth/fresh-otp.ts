export const DEFAULT_FRESH_OTP_WINDOW_MS = 5 * 60_000;
export function isFreshOtp(verifiedAt: number | null, now = Date.now(), maxAgeMs = DEFAULT_FRESH_OTP_WINDOW_MS) {
  return verifiedAt !== null && verifiedAt <= now && now - verifiedAt <= maxAgeMs;
}
