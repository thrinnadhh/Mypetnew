import { apiClient } from '../api-client';
import {
  clearPendingAppointmentPayment,
  fetchPaymentStatus,
  initiateAppointmentPayment,
  initiateOrderPayment,
  loadPendingAppointmentPayment,
  loadPendingPayment,
  rememberPendingAppointmentPayment,
  rememberPendingPayment,
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
      'Payment service returned an invalid canonical payment response.',
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
      'Payment service returned an invalid canonical payment response.',
    );

    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, referenceType: 'APPOINTMENT' });
    await expect(initiateOrderPayment('order-1', 'idem-type')).rejects.toThrow(
      'Payment service returned an invalid canonical payment response.',
    );
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('rejects a non-INR payment attempt', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, currency: 'USD' });

    await expect(initiateOrderPayment('order-1', 'idem-currency')).rejects.toThrow(
      'Payment service returned an invalid canonical payment response.',
    );
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('rejects missing, fractional or negative server amounts without tracking them', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: undefined });
    await expect(initiateOrderPayment('order-1', 'idem-amount-1')).rejects.toThrow(
      'Payment service returned an invalid canonical payment response.',
    );

    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: 100.5 });
    await expect(initiateOrderPayment('order-1', 'idem-amount-2')).rejects.toThrow(
      'Payment service returned an invalid canonical payment response.',
    );

    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: -1 });
    await expect(initiateOrderPayment('order-1', 'idem-amount-3')).rejects.toThrow(
      'Payment service returned an invalid canonical payment response.',
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
      'Payment service returned an invalid canonical payment response.',
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

  it('rejects a captured status payload bound to a different order and keeps recovery recoverable', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-verify-echo');
    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, referenceId: 'order-other', status: 'CAPTURED' });

    await expect(
      waitForPaymentOutcome('payment-1', 3, 0, undefined, { referenceType: 'PRODUCT_ORDER', referenceId: 'order-1' }),
    ).rejects.toThrow('Payment service returned an invalid canonical payment response.');

    expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
    await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
  });

  it('rejects mid-poll reference drift before any recovery clear', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-drift');
    mockedApiClient.get
      .mockResolvedValueOnce(canonicalPayment)
      .mockResolvedValueOnce({ ...canonicalPayment, referenceType: 'APPOINTMENT' });

    await expect(
      waitForPaymentOutcome('payment-1', 3, 0, undefined, { referenceType: 'PRODUCT_ORDER', referenceId: 'order-1' }),
    ).rejects.toThrow('Payment service returned an invalid canonical payment response.');

    await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
  });

  it('binds appointment verification to its own reference during polling', async () => {
    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'CAPTURED' });

    await expect(
      waitForPaymentOutcome('payment-1', 3, 0, 'customer-1', {
        referenceType: 'APPOINTMENT',
        referenceId: 'appointment-1',
      }),
    ).rejects.toThrow('Payment service returned an invalid canonical payment response.');
  });
});

const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';

describe('H2.1 recovery atomicity: pointer never mutates before identity proof', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearPendingAppointmentPayment(CUSTOMER_A);
  });

  it('Case A: product-order recovery returning a different paymentId rejects and preserves the original pointer', async () => {
    await rememberPendingPayment('payment-A', 'order-1');
    mockedApiClient.get.mockResolvedValueOnce({
      ...canonicalPayment,
      paymentId: 'payment-A',
      status: 'PENDING',
      paymentSessionId: null,
    });
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, paymentId: 'payment-B' });

    await expect(
      waitForPaymentOutcome('payment-A', 3, 0, undefined, {
        referenceType: 'PRODUCT_ORDER',
        referenceId: 'order-1',
      }),
    ).rejects.toThrow('Payment recovery returned an inconsistent server payment.');

    expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
    expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
    await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-A', orderId: 'order-1' });
  });

  it('Case B: appointment recovery returning a different paymentId rejects and preserves the account-scoped pointer', async () => {
    await rememberPendingAppointmentPayment('payment-A', 'appointment-1', CUSTOMER_A);
    mockedApiClient.get.mockResolvedValueOnce({
      ...canonicalPayment,
      paymentId: 'payment-A',
      referenceType: 'APPOINTMENT',
      referenceId: 'appointment-1',
      status: 'PENDING',
      paymentSessionId: null,
    });
    mockedApiClient.post.mockResolvedValueOnce({
      ...canonicalPayment,
      paymentId: 'payment-B',
      referenceType: 'APPOINTMENT',
      referenceId: 'appointment-1',
    });

    await expect(
      waitForPaymentOutcome('payment-A', 3, 0, CUSTOMER_A, {
        referenceType: 'APPOINTMENT',
        referenceId: 'appointment-1',
      }),
    ).rejects.toThrow('Payment recovery returned an inconsistent server payment.');

    await expect(loadPendingAppointmentPayment(CUSTOMER_A)).resolves.toEqual({
      paymentId: 'payment-A',
      appointmentId: 'appointment-1',
      customerId: CUSTOMER_A,
    });
  });

  it('Case C: recovery returning the same paymentId succeeds normally without corrupting the pointer', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-case-c');

    mockedApiClient.get.mockResolvedValueOnce({
      ...canonicalPayment,
      status: 'PENDING',
      paymentSessionId: null,
    });
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    mockedApiClient.get.mockResolvedValueOnce({ ...canonicalPayment, status: 'CAPTURED' });

    await expect(waitForPaymentOutcome('payment-1', 3, 0)).resolves.toMatchObject({ status: 'CAPTURED' });
    await expect(loadPendingPayment()).resolves.toBeNull();
  });
});

describe('H2.1 canonical runtime validation of polled status payloads', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  const verificationDrifts: Array<[string, Partial<CustomerPaymentView> | Record<string, unknown>]> = [
    ['a different payment ID', { paymentId: 'payment-B' }],
    ['a non-Cashfree provider', { provider: 'SOMETHING_OTHER_THAN_CASHFREE' }],
    ['a non-INR currency', { currency: 'USD' }],
    ['a fractional amount', { amountPaise: 100.5 }],
    ['a negative amount', { amountPaise: -1 }],
    ['a missing amount', { amountPaise: undefined }],
    ['an unsupported status', { status: 'MAGIC_SUCCESS' }],
  ];

  for (const [label, mutation] of verificationDrifts) {
    it(`fails closed when a captured status payload carries ${label}`, async () => {
      mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
      await initiateOrderPayment('order-1', `idem-drift-${label.replace(/\W+/g, '-')}`);
      await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });

      mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'CAPTURED', ...mutation });
      await expect(
        waitForPaymentOutcome('payment-1', 3, 0, undefined, {
          referenceType: 'PRODUCT_ORDER',
          referenceId: 'order-1',
        }),
      ).rejects.toThrow('Payment service returned an invalid canonical payment response.');

      await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
    });
  }

  it('clears the recovery pointer only for a fully canonical CAPTURED response', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-captured-clean');
    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'CAPTURED' });

    await expect(
      waitForPaymentOutcome('payment-1', 3, 0, undefined, {
        referenceType: 'PRODUCT_ORDER',
        referenceId: 'order-1',
      }),
    ).resolves.toMatchObject({ status: 'CAPTURED' });
    await expect(loadPendingPayment()).resolves.toBeNull();
  });

  it('keeps the recovery pointer intact for a canonical PENDING response', async () => {
    mockedApiClient.post.mockResolvedValueOnce(canonicalPayment);
    await initiateOrderPayment('order-1', 'idem-pending-clean');
    mockedApiClient.get.mockResolvedValue(canonicalPayment);

    await expect(
      waitForPaymentOutcome('payment-1', 3, 0, undefined, {
        referenceType: 'PRODUCT_ORDER',
        referenceId: 'order-1',
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
  });

  it('documents the H2 decision that zero-amount canonical payments remain accepted', async () => {
    mockedApiClient.post.mockResolvedValueOnce({ ...canonicalPayment, amountPaise: 0 });
    await expect(initiateOrderPayment('order-1', 'idem-zero')).resolves.toMatchObject({ amountPaise: 0 });
    await expect(loadPendingPayment()).resolves.toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
  });

  it('binds direct fetchPaymentStatus consumers to the expected payment identity and reference', async () => {
    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'CAPTURED' });

    await expect(
      fetchPaymentStatus('payment-1', { referenceType: 'PRODUCT_ORDER', referenceId: 'order-1' }),
    ).resolves.toMatchObject({ status: 'CAPTURED' });

    mockedApiClient.get.mockResolvedValue({ ...canonicalPayment, status: 'CAPTURED', paymentId: 'payment-B' });
    await expect(
      fetchPaymentStatus('payment-1', { referenceType: 'PRODUCT_ORDER', referenceId: 'order-1' }),
    ).rejects.toThrow('Payment service returned an invalid canonical payment response.');
  });
});
