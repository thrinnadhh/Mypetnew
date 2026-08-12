import {
  ApiError,
  apiErrorFromResponse,
  apiErrorKind,
  apiErrorMessage,
  normalizeApiErrorPayload,
  parseRetryAfter,
} from '@/contracts/api-error';
import {
  formatAppointmentStatus,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDeliveryStatus,
  formatDistance,
  formatOrderStatus,
  formatPercentage,
  formatStatusLabel,
  formatTime,
} from '../formatters';

function response(input: {
  body?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
} = {}): Response {
  const values = new Map(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    status: input.status ?? 500,
    statusText: input.statusText ?? '',
    headers: { get: (name: string) => values.get(name.toLowerCase()) ?? null },
    text: jest.fn().mockResolvedValue(input.body ?? ''),
  } as unknown as Response;
}

describe('production formatters', () => {
  it('formats currency values and rejects missing or non-finite inputs', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency(Number.NaN)).toBe('—');
    expect(formatCurrency(500)).toContain('500');
    expect(formatCurrency(500.5)).toContain('500.5');
    expect(formatCurrency(12.345, {
      locale: 'en-US', currency: 'USD', maximumFractionDigits: 1,
    })).toBe('$12.3');
  });

  it('formats dates, date-times and times with invalid fallbacks', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('2026-08-06T10:30:00Z', { year: 'numeric' }, 'en-US')).toBe('2026');
    expect(formatDateTime('2026-08-06T10:30:00Z', 'en-US')).not.toBe('—');
    expect(formatTime(new Date('2026-08-06T10:30:00Z'), 'en-US')).not.toBe('—');
  });

  it('formats distance, percentages and generic status labels', () => {
    for (const invalid of [null, undefined, Number.NaN, -1]) {
      expect(formatDistance(invalid)).toBe('—');
    }
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999.6)).toBe('1000 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12_400)).toBe('12 km');

    expect(formatPercentage(null)).toBe('—');
    expect(formatPercentage(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatPercentage(12.345, 2)).toBe('12.35%');

    expect(formatStatusLabel('')).toBe('—');
    expect(formatStatusLabel('  ready_for-pickup  ')).toBe('Ready For Pickup');
  });

  it('uses domain labels and safely humanizes unknown statuses', () => {
    expect(formatOrderStatus('READY_FOR_PICKUP')).toBe('Ready for pickup');
    expect(formatOrderStatus('custom_order_state')).toBe('Custom Order State');
    expect(formatOrderStatus(undefined)).toBe('—');
    expect(formatAppointmentStatus('NO_SHOW')).toBe('No-show');
    expect(formatAppointmentStatus('awaiting_doctor')).toBe('Awaiting Doctor');
    expect(formatDeliveryStatus('OUT_FOR_DELIVERY')).toBe('Out for delivery');
    expect(formatDeliveryStatus('')).toBe('—');
  });
});

describe('structured API errors', () => {
  it('parses Retry-After seconds, fractional seconds, dates and invalid values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('2.1')).toBe(3);
    // The implementation accepts HTTP-date syntax after numeric parsing. `-1`
    // is parsed as a date in the past and therefore clamps to an immediate retry.
    expect(parseRetryAfter('-1')).toBe(0);
    expect(parseRetryAfter('not-a-date')).toBeUndefined();

    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-06T00:00:00Z'));
    expect(parseRetryAfter('Thu, 06 Aug 2026 00:00:05 GMT')).toBe(5);
    expect(parseRetryAfter('Wed, 05 Aug 2026 00:00:00 GMT')).toBe(0);
    jest.restoreAllMocks();
  });

  it('normalizes top-level, nested, string and fallback payloads', () => {
    expect(normalizeApiErrorPayload(422, 'Unprocessable', {
      code: 'VALIDATION_FAILED',
      message: 'Check fields',
      traceId: 'trace-top',
      fieldErrors: {
        phone: ' Required ',
        name: [' Missing ', '', 42],
        ignored: 3,
      },
      details: { field: 'phone' },
    })).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Check fields',
      traceId: 'trace-top',
      fieldErrors: { phone: ['Required'], name: ['Missing'] },
      details: { field: 'phone' },
    });

    expect(normalizeApiErrorPayload(409, 'Conflict', {
      error: {
        code: 'DUPLICATE', message: 'Already exists', traceId: 'nested-trace',
        fieldErrors: { item: ['duplicate'] }, details: { id: '1' },
      },
    }, 'header-trace')).toMatchObject({
      code: 'DUPLICATE', message: 'Already exists', traceId: 'nested-trace',
      fieldErrors: { item: ['duplicate'] }, details: { id: '1' },
    });

    expect(normalizeApiErrorPayload(500, '', ' plain failure ', 'header-trace')).toMatchObject({
      code: 'HTTP_500', message: 'plain failure', traceId: 'header-trace', fieldErrors: {},
    });
    expect(normalizeApiErrorPayload(418, "I'm a teapot", null)).toMatchObject({
      code: 'HTTP_418', message: "Request failed: I'm a teapot", fieldErrors: {},
    });
    expect(normalizeApiErrorPayload(400, '', { error: ' simple error ', requestId: 'request-1' }))
      .toMatchObject({ code: 'HTTP_400', message: 'simple error', traceId: 'request-1' });
  });

  it('builds ApiError from JSON and plain-text HTTP responses', async () => {
    const jsonError = await apiErrorFromResponse(response({
      status: 429,
      statusText: 'Too Many Requests',
      body: JSON.stringify({ code: 'RATE_LIMITED', message: 'Slow down' }),
      headers: { 'x-request-id': 'request-1', 'retry-after': '4' },
    }));
    expect(jsonError).toBeInstanceOf(ApiError);
    expect(jsonError).toMatchObject({
      status: 429, code: 'RATE_LIMITED', message: 'Slow down',
      traceId: 'request-1', retryAfterSeconds: 4,
    });

    const textError = await apiErrorFromResponse(response({
      status: 502, statusText: 'Bad Gateway', body: 'upstream unavailable',
      headers: { 'x-trace-id': 'trace-2' },
    }));
    expect(textError).toMatchObject({
      status: 502, code: 'HTTP_502', message: 'upstream unavailable', traceId: 'trace-2',
    });
  });

  it('classifies every API status family and preserves useful messages', () => {
    const make = (status: number) => new ApiError(status, {
      code: `HTTP_${status}`, message: `Error ${status}`, fieldErrors: {},
    });
    expect(apiErrorKind(make(401))).toBe('authentication');
    expect(apiErrorKind(make(403))).toBe('authorization');
    expect(apiErrorKind(make(404))).toBe('not-found');
    expect(apiErrorKind(make(409))).toBe('conflict');
    expect(apiErrorKind(make(400))).toBe('validation');
    expect(apiErrorKind(make(422))).toBe('validation');
    expect(apiErrorKind(make(429))).toBe('rate-limit');
    expect(apiErrorKind(make(503))).toBe('server');
    expect(apiErrorKind(make(302))).toBe('unknown');
    expect(apiErrorKind(new TypeError('Network request failed'))).toBe('network');
    expect(apiErrorKind('failure')).toBe('unknown');
    expect(apiErrorMessage(new Error('Useful message'))).toBe('Useful message');
    expect(apiErrorMessage(new Error('   '), 'Fallback')).toBe('Fallback');
    expect(apiErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});

describe('mobile configuration gates', () => {
  const originalEnv = { ...process.env };
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(globalThis, '__DEV__', {
      value: originalDev,
      configurable: true,
      writable: true,
    });
    jest.resetModules();
    jest.dontMock('react-native');
  });

  function loadConfig(input: {
    dev: boolean;
    platform: 'android' | 'ios';
    env?: Record<string, string | undefined>;
  }) {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const [key, value] of Object.entries(input.env ?? {})) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    Object.defineProperty(globalThis, '__DEV__', {
      value: input.dev,
      configurable: true,
      writable: true,
    });
    jest.doMock('react-native', () => ({
      Platform: {
        select: (values: Record<string, string>) => values[input.platform] ?? values.default,
      },
    }));

    let loaded: typeof import('../app-config');
    jest.isolateModules(() => {
      loaded = require('../app-config') as typeof import('../app-config');
    });
    return loaded!;
  }

  it('uses the Android development gateway and permits explicitly enabled demo fixtures', () => {
    const loaded = loadConfig({
      dev: true,
      platform: 'android',
      env: {
        EXPO_PUBLIC_API_BASE_URL: undefined,
        EXPO_PUBLIC_SUPABASE_URL: undefined,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined,
        EXPO_PUBLIC_ALLOW_DEMO_MODE: '1',
      },
    });
    expect(loaded.appConfig).toMatchObject({
      apiBaseUrl: 'http://10.0.2.2:8080', allowDemoMode: true,
    });
    expect(loaded.requireMobileConfig()).toBeUndefined();
  });

  it('trims configured URLs and accepts complete HTTPS production configuration', () => {
    const loaded = loadConfig({
      dev: false,
      platform: 'ios',
      env: {
        EXPO_PUBLIC_API_BASE_URL: ' https://api.mypet.test/// ',
        EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        EXPO_PUBLIC_ALLOW_DEMO_MODE: 'true',
      },
    });
    expect(loaded.appConfig).toMatchObject({
      apiBaseUrl: 'https://api.mypet.test', allowDemoMode: false,
    });
    expect(loaded.requireMobileConfig()).toBeUndefined();
  });

  it('fails closed for missing production settings and insecure API URLs', () => {
    const missing = loadConfig({
      dev: false,
      platform: 'ios',
      env: {
        EXPO_PUBLIC_API_BASE_URL: undefined,
        EXPO_PUBLIC_SUPABASE_URL: undefined,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined,
      },
    });
    expect(() => missing.requireMobileConfig()).toThrow(
      'EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY',
    );

    const insecure = loadConfig({
      dev: false,
      platform: 'ios',
      env: {
        EXPO_PUBLIC_API_BASE_URL: 'http://api.mypet.test',
        EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      },
    });
    expect(() => insecure.requireMobileConfig()).toThrow('must use HTTPS');
  });
});
