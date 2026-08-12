import {
  ApiError,
  apiErrorKind,
  normalizeApiErrorPayload,
  parseRetryAfter,
} from '../api-error';
import {
  formatAppointmentStatus,
  formatCurrency,
  formatDistance,
  formatOrderStatus,
  formatStatusLabel,
} from '../../utils/formatters';

describe('shared API error and formatting contract', () => {
  it('preserves backend code, trace and field validation details', () => {
    const payload = normalizeApiErrorPayload(
      422,
      'Unprocessable Entity',
      {
        code: 'INVALID_CHECKOUT',
        message: 'Checkout details are invalid.',
        traceId: 'trace-123',
        fieldErrors: { addressId: 'Address is required.', quantity: ['Must be positive.'] },
      },
    );

    expect(payload).toEqual({
      code: 'INVALID_CHECKOUT',
      message: 'Checkout details are invalid.',
      traceId: 'trace-123',
      fieldErrors: { addressId: ['Address is required.'], quantity: ['Must be positive.'] },
      details: undefined,
    });
  });

  it('uses the request header trace and deterministic HTTP fallback', () => {
    expect(normalizeApiErrorPayload(503, 'Service Unavailable', {}, 'request-9')).toMatchObject({
      code: 'HTTP_503',
      message: 'Request failed: Service Unavailable',
      traceId: 'request-9',
    });
  });

  it('classifies retryable and validation failures', () => {
    const validation = new ApiError(422, {
      code: 'INVALID',
      message: 'Invalid input',
      fieldErrors: {},
    });
    const rateLimit = new ApiError(429, {
      code: 'RATE_LIMITED',
      message: 'Retry later',
      fieldErrors: {},
    });

    expect(apiErrorKind(validation)).toBe('validation');
    expect(apiErrorKind(rateLimit)).toBe('rate-limit');
    expect(parseRetryAfter('12')).toBe(12);
  });

  it('formats Indian commerce and shared lifecycle terminology', () => {
    expect(formatCurrency(1250)).toContain('1,250');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatOrderStatus('READY_FOR_PICKUP')).toBe('Ready for pickup');
    expect(formatAppointmentStatus('RESCHEDULE_REQUESTED')).toBe('Reschedule requested');
    expect(formatStatusLabel('PAYMENT_FAILED')).toBe('Payment Failed');
  });
});
