import { apiClient } from '../api-client';
import {
  fetchPaymentStatus,
  initiateAppointmentPayment,
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initiates an APPOINTMENT payment without client-authored amount or identity', async () => {
    mockedApiClient.post.mockResolvedValueOnce(pendingPayment);

    await expect(initiateAppointmentPayment('appointment/1', 'appointment-payment-key')).resolves.toEqual(pendingPayment);

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
  });

  it('loads canonical backend payment state by payment ID', async () => {
    mockedApiClient.get.mockResolvedValueOnce({ ...pendingPayment, status: 'CAPTURED' as const });

    await expect(fetchPaymentStatus('payment/1')).resolves.toMatchObject({ status: 'CAPTURED' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('/api/v1/customer/payments/payment%2F1');
  });

  it('polls backend state until the appointment payment becomes captured', async () => {
    mockedApiClient.get
      .mockResolvedValueOnce(pendingPayment)
      .mockResolvedValueOnce({ ...pendingPayment, status: 'CAPTURED' as const });

    await expect(waitForPaymentOutcome('payment-1', 2, 0)).resolves.toMatchObject({
      referenceType: 'APPOINTMENT',
      status: 'CAPTURED',
    });
    expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
  });

  it('keeps reference-only payment success checks fail closed', async () => {
    await expect(waitForReferencePaymentOutcome('appointment/1')).rejects.toThrow(
      'Use the canonical payment ID to verify appointment payment status.',
    );
    expect(mockedApiClient.get).not.toHaveBeenCalled();
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});
