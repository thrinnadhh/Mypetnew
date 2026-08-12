import * as WebBrowser from 'expo-web-browser';

import { apiClient } from '../api-client';
import {
  initiateAppointmentPayment,
  openCashfreeOrder,
  waitForReferencePaymentOutcome,
} from '../customer-payments';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

jest.mock('../api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedBrowser = WebBrowser as jest.Mocked<typeof WebBrowser>;

const appointmentPayment = {
  transactionId: 'txn-appointment-1',
  referenceId: 'appointment/1',
  transactionType: 'APPOINTMENT_PAYMENT',
  amount: 799,
  currency: 'INR',
  status: 'SUCCESS' as const,
  createdAt: '2026-08-07T00:00:00Z',
  updatedAt: '2026-08-07T00:01:00Z',
};

describe('customer appointment payments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an appointment Cashfree payment with the appointment transaction type', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      orderId: 'cf-appointment-1',
      paymentSessionId: 'session-appointment-1',
      amount: 799,
      currency: 'INR',
      transactionId: 'txn-appointment-1',
      environment: 'SANDBOX',
    });

    await initiateAppointmentPayment('user-1', 'appointment/1', 799, {
      phone: '919876543210',
      email: null,
      name: null,
    });

    expect(mockedApiClient.post).toHaveBeenCalledWith('/api/v1/payments/appointments', {
      userId: 'user-1',
      referenceId: 'appointment/1',
      amount: 799,
      transactionType: 'APPOINTMENT_PAYMENT',
      customerPhone: '9876543210',
      customerEmail: null,
      customerName: null,
    });
  });

  it('polls authoritative appointment payment status with GET until terminal', async () => {
    mockedApiClient.get
      .mockResolvedValueOnce({ ...appointmentPayment, status: 'PENDING' })
      .mockResolvedValueOnce(appointmentPayment);

    const result = await waitForReferencePaymentOutcome('appointment/1', 3, 0);

    expect(result.status).toBe('SUCCESS');
    expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/payments/transactions/reference/appointment%2F1',
    );
    expect(mockedApiClient.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/payments/transactions/reference/appointment%2F1',
    );
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });

  it('accepts an absolute hosted checkout URL from the trusted payment service', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      checkoutPath: 'https://checkout.mypet.test/session/appointment-1',
      expiresAt: '2026-08-07T00:15:00Z',
    });
    mockedBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'customerapp://payments/result',
    });

    await openCashfreeOrder({
      orderId: 'cf-appointment-1',
      paymentSessionId: 'session-appointment-1',
      amount: 799,
      currency: 'INR',
      transactionId: 'txn-appointment-1',
      environment: 'SANDBOX',
    });

    expect(mockedBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://checkout.mypet.test/session/appointment-1',
      'customerapp://payments/result',
      expect.objectContaining({ showInRecents: true }),
    );
  });
});
