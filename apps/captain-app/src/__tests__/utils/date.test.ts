import {
  formatCountdown,
  formatDate,
  formatDateTime,
  formatTime,
  getRemainingSeconds,
} from '../../utils/date';

describe('Date & Countdown Utilities', () => {
  it('formats countdown MM:SS correctly', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(24)).toBe('00:24');
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(3600)).toBe('60:00');
  });

  it('calculates remaining seconds from future timestamp', () => {
    const future = new Date(Date.now() + 25000).toISOString();
    const remaining = getRemainingSeconds(future);
    expect(remaining).toBeGreaterThanOrEqual(24);
    expect(remaining).toBeLessThanOrEqual(25);
  });

  it('clamps remaining seconds to 0 for past timestamps', () => {
    const past = new Date(Date.now() - 5000).toISOString();
    expect(getRemainingSeconds(past)).toBe(0);
  });

  it('formats time and dates without throwing on invalid input', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatTime('invalid-date')).toBe('—');
  });
});
