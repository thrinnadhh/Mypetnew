import { apiClient } from '../api-client';
import {
  initiateAppointmentPayment,
  initiateOrderPayment,
  loadPendingPayment,
  waitForPaymentOutcome,
} from '../customer-payments';
import type { CustomerPaymentView } from '../customer-payments';

/**
 * H2 orders/payment invariant regressions.
 *
 * Pins the canonical CustomerPayment contract at the client boundary: the
 * provider payment attempt must belong to the authenticated actor's order
 * reference, stay CASHFREE/INR with sane server-owned amounts, and a mismatched
 * server payload must fail closed before any local recovery state is written.
 *
 * Mutation notes:
 * - Dropping validateCanonicalPaymentContract from initiateOrderPayment fails
 *   tests 1-4 (a foreign reference could silently become the tracked payment).
 * - Removing currency/amount checks fails tests 3-4.
 */
jest.mock('../api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const canonicalPayment: CustomerPaymentView = {
  paymentId: 'payment-1',
  referenceType: 'PRODUCT_ORDER',
  referenceId: 'order-1',
  provider: 'CASHFREE',
  providerOrderId: 'ma_123',
  status: 'PENDING',
  paymentSessionId: 'session-1',
  expiresAt: '2026-08-26T12:15:00Z',
  amountPaise: 79_900,
  currency: 'INR',
  refundStatus: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
});

describe('H2 order payment initiation contract', () => {
  it('rejects a payment bound to a different order reference before writing recovery state', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, referenceId: 'order-other' });

    await expect(initiateOrderPayment('order-1', 'idem-echo')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );
    expect(mockedApiClient.post).toHaveBeenCalledWith(
      '/api/v1/customer/payments',
      { referenceType: 'PRODUCT_ORDER', referenceId: 'order-1', provider: 'CASHFREE' },
      { 'Idempotency-Key': 'idem-echo' },
    );
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('rejects a payment whose provider or type is not the canonical Cashfree product payment', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, provider: 'UNKNOWN_PSP' });
    await expect(initiateOrderPayment('order-1', 'idem-provider')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );

    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, referenceType: 'APPOINTMENT' });
    await expect(initiateOrderPayment('order-1', 'idem-type')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('rejects a non-INR payment attempt', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, currency: 'USD' });

    await expect(initiateOrderPayment('order-1', 'idem-currency')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('rejects missing, fractional or negative server amounts without tracking them', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: undefined });
    await expect(initiateOrderPayment('order-1', 'idem-amount-1')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );

    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: 100.5 });
    await expect(initiateOrderPayment('order-1', 'idem-amount-2')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );

    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: -1 });
    await expect(initiateOrderPayment('order-1', 'idem-amount-3')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );

    expect(mockedApiClient.post).toHaveBeenCalledTimes(3);
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('never authors money or identity fields on the product payment request', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);

    await initiateOrderPayment('order-1', 'idem-clean');

    expect(JSON.stringify(mockedApiClient.post.mock.calls[0])).not.toMatch(/amountPaise|currency:|customerId:|userId:/);
  });

  it('applies the same structural contract to appointment payments', async () => {
    const appointmentPayment: CustomerPaymentView = {
      ...canonicalPayment,
      paymentId: 'payment-appt-1',
      referenceType: 'APPOINTMENT',
      referenceId: 'appointment-1',
    };
    mockedApiClient.post.mockResolvedValueOnce({ ...appointmentPayment, currency: 'EUR' });
    await expect(initiateAppointmentPayment('appointment-1', 'customer-1', 'idem-appt-1')).rejects.toThrow(
      'Payment service returned an unsupported canonical payment contract.',
    );

    mockedApiClient.post.mockResolvedValueOnce(appointmentPayment);
    await expect(initiateAppointmentPayment('appointment-1', 'customer-1', 'idem-appt-2')).resolves.toEqual(
      appointmentPayment,
    );
  });
});

describe('H2 duplicate verification and outcome recovery', () => {
  it('verifies a captured payment idempotently: polling only, single recovery clear, replay-safe', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-dup');
    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'CAPTURED' });

    const first = await waitForPaymentOutcome('payment-1', 3, 0);
    const second = await waitForPaymentOutcome('payment-1', 3, 0);

    expect(first.status).toBe('CAPTURED');
    expect(second.status).toBe('CAPTURED');
    expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
    expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('clears the pending pointer on a FAILED outcome so the order stays payable again', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-failed');
    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'FAILED' });

    const outcome = await waitForPaymentOutcome('payment-1', 3, 0);

    expect(outcome.status).toBe('FAILED');
    expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('keeps the pending pointer and returns PENDING when the backend stays non-terminal', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-pending');
    mockedApiClient.get.mockResolvedValue(canonicalPayment);

    const outcome = await waitForPaymentOutcome('payment-1', 3, 0);

    expect(outcome.status).toBe('PENDING');
    await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
  });
});
