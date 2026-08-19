import { apiClient } from '../api-client';
import {
  clearPendingAppointmentPayment,
  fetchPaymentStatus,
  initiateAppointmentPayment,
  loadPendingAppointmentPayment,
  waitForPaymentOutcome,
  waitForReferencePaymentOutcome,
} from '../customer-payments';

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
const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_B = '22222222-2222-4222-8222-222222222222';

const pendingPayment = {
  paymentId: 'payment-1',
  referenceType: 'APPOINTMENT' as const,
  referenceId: 'appointment/1',
  provider: 'CASHFREE' as const,
  providerOrderId: 'ma_123',
  status: 'PENDING' as const,
  paymentSessionId: 'session-1',
  expiresAt: '2026-08-16T12:15:00Z',
  amountPaise: 79_900,
  currency: 'INR' as const,
  refundStatus: null,
};

describe('customer appointment Cashfree client', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all([
      clearPendingAppointmentPayment(CUSTOMER_A),
      clearPendingAppointmentPayment(CUSTOMER_B),
    ]);
  });

  it('initiates an APPOINTMENT payment without client-authored amount or identity and persists account-scoped recovery', async () => {
    mockedApiClient.post.mockResolvedValueOnce(pendingPayment);

    await expect(
      initiateAppointmentPayment('appointment/1', CUSTOMER_A, 'appointment-payment-key'),
    ).resolves.toEqual(pendingPayment);

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      '/api/v1/customer/payments',
      {
        referenceType: 'APPOINTMENT',
        referenceId: 'appointment/1',
        provider: 'CASHFREE',
      },
      { 'Idempotency-Key': 'appointment-payment-key' },
    );
    const body = mockedApiClient.post.mock.calls[0][1];
    expect(JSON.stringify(body)).not.toMatch(/amountPaise|currency|customerId|userId|phone|email/);
    await expect(loadPendingAppointmentPayment(CUSTOMER_A)).resolves.toEqual({
      paymentId: 'payment-1',
      appointmentId: 'appointment/1',
      customerId: CUSTOMER_A,
    });
  });

  it('rejects a mismatched appointment reference before writing recovery', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      ...pendingPayment,
      referenceId: 'appointment/other',
    });

    await expect(
      initiateAppointmentPayment('appointment/1', CUSTOMER_A, 'appointment-reference-mismatch'),
    ).rejects.toThrow('Payment initiation returned a different appointment reference.');
    await expect(loadPendingAppointmentPayment(CUSTOMER_A)).resolves.toBeNull();
  });

  it('never exposes one customers pending appointment payment to another account', async () => {
    mockedApiClient.post.mockResolvedValueOnce(pendingPayment);
    await initiateAppointmentPayment('appointment/1', CUSTOMER_A, 'appointment-payment-account-isolation');

    await expect(loadPendingAppointmentPayment(CUSTOMER_A)).resolves.toMatchObject({
      paymentId: 'payment-1',
      customerId: CUSTOMER_A,
    });
    await expect(loadPendingAppointmentPayment(CUSTOMER_B)).resolves.toBeNull();
  });

  it('loads canonical backend payment state by payment ID', async () => {
    mockedApiClient.get.mockResolvedValueOnce({ ...pendingPayment, status: 'CAPTURED' as const });

    await expect(fetchPaymentStatus('payment/1')).resolves.toMatchObject({ status: 'CAPTURED' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('/api/v1/customer/payments/payment%2F1');
  });

  it('polls backend state until the appointment payment becomes captured and clears only that accounts recovery', async () => {
    mockedApiClient.post.mockResolvedValueOnce(pendingPayment);
    await initiateAppointmentPayment('appointment/1', CUSTOMER_A, 'appointment-payment-key');

    mockedApiClient.get
      .mockResolvedValueOnce(pendingPayment)
      .mockResolvedValueOnce({ ...pendingPayment, status: 'CAPTURED' as const });

    await expect(waitForPaymentOutcome('payment-1', 2, 0, CUSTOMER_A)).resolves.toMatchObject({
      referenceType: 'APPOINTMENT',
      status: 'CAPTURED',
    });
    expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
    await expect(loadPendingAppointmentPayment(CUSTOMER_A)).resolves.toBeNull();
  });

  it('fails closed when appointment verification has no current customer identity', async () => {
    mockedApiClient.get.mockResolvedValueOnce(pendingPayment);

    await expect(waitForPaymentOutcome('payment-1', 1, 0)).rejects.toThrow(
      'Current customer identity is required to verify an appointment payment.',
    );
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });

  it('keeps reference-only payment success checks fail closed', async () => {
    await expect(waitForReferencePaymentOutcome('appointment/1')).rejects.toThrow(
      'Use the canonical payment ID to verify appointment payment status.',
    );
    expect(mockedApiClient.get).not.toHaveBeenCalled();
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});
