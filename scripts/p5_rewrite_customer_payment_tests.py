from pathlib import Path

p = Path('apps/customer-app/src/services/__tests__/high-risk-customer-services.test.ts')
text = p.read_text()
text = text.replace("import * as WebBrowser from 'expo-web-browser';\n", '')
old_import = """import {
  createHostedCheckoutSession,
  fetchOrderPaymentStatus,
  initiateOrderPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
} from '../customer-payments';"""
new_import = """import {
  clearPendingPayment,
  fetchPaymentStatus,
  initiateOrderPayment,
  loadPendingPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
} from '../customer-payments';"""
text = text.replace(old_import, new_import)
old_mock = """jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedBrowser = WebBrowser as jest.Mocked<typeof WebBrowser>;"""
new_mock = """const mockSetCashfreeCallback = jest.fn();
const mockRemoveCashfreeCallback = jest.fn();
const mockDoCashfreeWebPayment = jest.fn();

jest.mock('react-native-cashfree-pg-sdk', () => ({
  CFPaymentGatewayService: {
    setCallback: mockSetCashfreeCallback,
    removeCallback: mockRemoveCashfreeCallback,
    doWebPayment: mockDoCashfreeWebPayment,
  },
}));

jest.mock('cashfree-pg-api-contract', () => ({
  CFEnvironment: { SANDBOX: 'SANDBOX', PRODUCTION: 'PRODUCTION' },
  CFSession: jest.fn().mockImplementation((paymentSessionId, orderId, environment) => ({
    paymentSessionId,
    orderId,
    environment,
  })),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;"""
text = text.replace(old_mock, new_mock)
text = text.replace("    allowDemoMode: false,\n", "    allowDemoMode: false,\n    environment: 'development',\n")

payment_start = text.index('const payment = {')
root_describe = text.index("describe('high-risk customer service contracts'", payment_start)
new_payment = """const payment = {
  paymentId: 'payment-1',
  referenceType: 'PRODUCT_ORDER' as const,
  referenceId: 'order-1',
  provider: 'CASHFREE' as const,
  providerOrderId: 'mp_12345678901234567890123456789012',
  status: 'PENDING' as const,
  paymentSessionId: 'session-1',
  expiresAt: '2026-08-15T12:15:00Z',
  amountPaise: 49_900,
  currency: 'INR' as const,
  refundStatus: null,
};

"""
text = text[:payment_start] + new_payment + text[root_describe:]

start = text.index("  describe('payments', () => {")
end = text.index("  describe('recurring orders', () => {", start)
new_block = """  describe('payments', () => {
    it('initiates only the canonical server-authoritative product payment request', async () => {
      mockedApiClient.post.mockResolvedValueOnce(payment);

      await expect(initiateOrderPayment('order-1', 'idem-1')).resolves.toEqual(payment);

      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/api/v1/customer/payments',
        {
          referenceType: 'PRODUCT_ORDER',
          referenceId: 'order-1',
          provider: 'CASHFREE',
        },
        { 'Idempotency-Key': 'idem-1' },
      );
      expect(JSON.stringify(mockedApiClient.post.mock.calls[0])).not.toContain('userId');
      expect(JSON.stringify(mockedApiClient.post.mock.calls[0])).not.toContain('amountPaise');
      expect(await loadPendingPayment()).toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
    });

    it('treats native Cashfree callbacks only as a signal to verify backend truth', async () => {
      const pending = openCashfreeOrder(payment);
      expect(mockSetCashfreeCallback).toHaveBeenCalledTimes(1);
      expect(mockDoCashfreeWebPayment).toHaveBeenCalledTimes(1);

      const callback = mockSetCashfreeCallback.mock.calls[0][0];
      callback.onVerify(payment.providerOrderId);

      await expect(pending).resolves.toBe('VERIFY');
      expect(mockRemoveCashfreeCallback).toHaveBeenCalled();
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });

    it('polls only canonical payment status and clears recovery after capture', async () => {
      mockedApiClient.get
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce({ ...payment, status: 'CAPTURED' });
      await AsyncStorage.setItem(
        'mypet.customer.pending-payment.v1',
        JSON.stringify({ paymentId: payment.paymentId, orderId: payment.referenceId }),
      );

      const result = await waitForPaymentOutcome(payment.paymentId, 3, 0);

      expect(result.status).toBe('CAPTURED');
      expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
      expect(mockedApiClient.get).toHaveBeenNthCalledWith(1, '/api/v1/customer/payments/payment-1');
      expect(mockedApiClient.post).not.toHaveBeenCalled();
      expect(await loadPendingPayment()).toBeNull();
    });

    it('reads owned server payment status and recovery storage contains safe ids only', async () => {
      mockedApiClient.get.mockResolvedValueOnce({ ...payment, status: 'AUTHORIZED' });

      await expect(fetchPaymentStatus('payment/1')).resolves.toMatchObject({ status: 'AUTHORIZED' });
      expect(mockedApiClient.get).toHaveBeenCalledWith('/api/v1/customer/payments/payment%2F1');

      await AsyncStorage.setItem(
        'mypet.customer.pending-payment.v1',
        JSON.stringify({ paymentId: 'payment-2', orderId: 'order-2' }),
      );
      expect(await loadPendingPayment()).toEqual({ paymentId: 'payment-2', orderId: 'order-2' });
      await clearPendingPayment('payment-2');
      expect(await loadPendingPayment()).toBeNull();
    });
  });

"""
text = text[:start] + new_block + text[end:]
p.write_text(text)
