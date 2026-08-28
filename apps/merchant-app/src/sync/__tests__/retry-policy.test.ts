import { SyncRetryPolicy } from '../retry-policy';

describe('M6 SyncRetryPolicy', () => {
  it('calculates exponential backoff with bounded jitter', () => {
    let mockRandom = 0.0;
    const policy = new SyncRetryPolicy({
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      random: () => mockRandom,
    });

    expect(policy.calculateBackoffMs(1)).toBe(1000);
    expect(policy.calculateBackoffMs(2)).toBe(2000);
    expect(policy.calculateBackoffMs(3)).toBe(4000);
    expect(policy.calculateBackoffMs(4)).toBe(8000);
    expect(policy.calculateBackoffMs(5)).toBe(16000);
    expect(policy.calculateBackoffMs(6)).toBe(30000); // Capped at maxDelayMs

    // With 100% jitter (0.25 max)
    mockRandom = 1.0;
    expect(policy.calculateBackoffMs(1)).toBe(1250); // 1000 + 250
  });

  it('correctly parses Retry-After header in seconds and HTTP-Date formats', () => {
    const fixedNow = Date.parse('2026-08-28T12:00:00.000Z');
    const policy = new SyncRetryPolicy({
      maxDelayMs: 120000,
      clock: () => fixedNow,
    });

    // 1. Seconds
    expect(policy.parseRetryAfterHeader('45')).toBe(45000);
    expect(policy.parseRetryAfterHeader('0')).toBe(0);
    expect(policy.parseRetryAfterHeader('   60  ')).toBe(60000);

    // 2. HTTP-Date (30s in future)
    const futureDateStr = new Date(fixedNow + 30000).toUTCString();
    expect(policy.parseRetryAfterHeader(futureDateStr)).toBe(30000);

    // 3. Past HTTP-Date
    const pastDateStr = new Date(fixedNow - 10000).toUTCString();
    expect(policy.parseRetryAfterHeader(pastDateStr)).toBe(0);

    // 4. Invalid
    expect(policy.parseRetryAfterHeader(null)).toBeNull();
    expect(policy.parseRetryAfterHeader('')).toBeNull();
    expect(policy.parseRetryAfterHeader('invalid-string')).toBeNull();
  });

  it('classifies HTTP status codes and terminal vs retryable failures accurately', () => {
    const policy = new SyncRetryPolicy({
      maxAttempts: 5,
      random: () => 0,
    });

    // 400 Bad Request -> REJECT
    const res400 = policy.evaluateError(new Error('Validation error'), 1, 400);
    expect(res400.action).toBe('REJECT');

    // 422 Unprocessable -> REJECT
    const res422 = policy.evaluateError(new Error('Unprocessable entity'), 1, 422);
    expect(res422.action).toBe('REJECT');

    // 409 Conflict -> CONFLICT
    const res409 = policy.evaluateError(new Error('Version conflict'), 1, 409);
    expect(res409.action).toBe('CONFLICT');

    // 401 / 403 -> AUTH_REFRESH
    const res401 = policy.evaluateError(new Error('Unauthorized'), 1, 401);
    expect(res401.action).toBe('AUTH_REFRESH');

    // 429 Rate Limited with Retry-After header
    const res429 = policy.evaluateError(new Error('Too Many Requests'), 1, 429, '15');
    expect(res429.action).toBe('RETRY');
    if (res429.action === 'RETRY') {
      expect(res429.delayMs).toBe(15000);
    }

    // 500 Server Error -> RETRY with backoff
    const res500 = policy.evaluateError(new Error('Internal server error'), 2, 500);
    expect(res500.action).toBe('RETRY');
    if (res500.action === 'RETRY') {
      expect(res500.delayMs).toBe(2000);
    }

    // Network disconnection (no HTTP status) -> RETRY
    const resNet = policy.evaluateError(new Error('Network request failed'), 1);
    expect(resNet.action).toBe('RETRY');

    // Exceeding max attempts -> REJECT
    const resMax = policy.evaluateError(new Error('Timeout'), 5);
    expect(resMax.action).toBe('REJECT');
    if (resMax.action === 'REJECT') {
      expect(resMax.errorCode).toBe('MAX_RETRY_ATTEMPTS_EXCEEDED');
    }
  });
});
