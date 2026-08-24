import {
  formatCountdown,
  formatDate,
  formatDateTime,
  formatTime,
  getRemainingSeconds,
} from '../../../utils/date';

describe('Level 1: Date & Countdown Utility Tests', () => {
  it('formats MM:SS countdown strings properly', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(5)).toBe('00:05');
    expect(formatCountdown(45)).toBe('00:45');
    expect(formatCountdown(60)).toBe('01:00');
    expect(formatCountdown(125)).toBe('02:05');
    expect(formatCountdown(3600)).toBe('60:00');
  });

  it('computes remaining seconds from ISO expiration timestamps', () => {
    const future = new Date(Date.now() + 20000).toISOString();
    const remaining = getRemainingSeconds(future);
    expect(remaining).toBeGreaterThanOrEqual(19);
    expect(remaining).toBeLessThanOrEqual(20);

    const past = new Date(Date.now() - 5000).toISOString();
    expect(getRemainingSeconds(past)).toBe(0);
  });

  it('formats date and time defensively without throwing on invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatTime(null)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatTime('not-a-date')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');

    const validIso = '2026-08-23T10:30:00.000Z';
    expect(formatDate(validIso)).not.toBe('—');
    expect(formatTime(validIso)).not.toBe('—');
    expect(formatDateTime(validIso)).not.toBe('—');
  });
});
