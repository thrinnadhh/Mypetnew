from pathlib import Path

path = Path('apps/customer-app/src/services/__tests__/high-risk-customer-services.test.ts')
text = path.read_text()

old_mocks = '''const mockSetCashfreeCallback = jest.fn();
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
'''
new_mocks = '''const mockOpenCashfreeNativeCheckout = jest.fn();

jest.mock('../cashfree-native', () => ({
  openCashfreeNativeCheckout: mockOpenCashfreeNativeCheckout,
}));
'''
if old_mocks not in text:
    raise SystemExit('expected old Cashfree mock block not found')
text = text.replace(old_mocks, new_mocks, 1)

old_callback_test = '''    it('treats native Cashfree callbacks only as a signal to verify backend truth', async () => {
      const pending = openCashfreeOrder(payment);
      expect(mockSetCashfreeCallback).toHaveBeenCalledTimes(1);
      expect(mockDoCashfreeWebPayment).toHaveBeenCalledTimes(1);

      const callback = mockSetCashfreeCallback.mock.calls[0][0];
      callback.onVerify(payment.providerOrderId);

      await expect(pending).resolves.toBe('VERIFY');
      expect(mockRemoveCashfreeCallback).toHaveBeenCalled();
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });
'''
new_callback_test = '''    it('treats native Cashfree callbacks only as a signal to verify backend truth', async () => {
      mockOpenCashfreeNativeCheckout.mockResolvedValueOnce('VERIFY');

      await expect(openCashfreeOrder(payment)).resolves.toBe('VERIFY');

      expect(mockOpenCashfreeNativeCheckout).toHaveBeenCalledWith({
        paymentSessionId: payment.paymentSessionId,
        providerOrderId: payment.providerOrderId,
      });
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });
'''
if old_callback_test not in text:
    raise SystemExit('expected old callback test not found')
text = text.replace(old_callback_test, new_callback_test, 1)

old_hosted = '''
  it('exposes the standalone hosted-session helper for callers that prefetch checkout', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      checkoutPath: 'https://checkout.mypet.test/session',
      expiresAt: '2026-08-06T00:15:00Z',
    });
    await expect(createHostedCheckoutSession('txn-1')).resolves.toMatchObject({
      checkoutPath: 'https://checkout.mypet.test/session',
    });
  });
'''
if old_hosted not in text:
    raise SystemExit('expected obsolete hosted-session test not found')
text = text.replace(old_hosted, '', 1)

path.write_text(text)
