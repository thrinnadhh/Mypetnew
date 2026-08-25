import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiClient } from '../api-client';
// The extensionless specifier resolves to the platform-selected module; here it
// is intercepted by the jest.mock below so tests never load the real SDK.
import { openCashfreeNativeCheckout } from '../cashfree-native';
import { openCashfreeOrder, waitForPaymentOutcome } from '../customer-payments';
import type { CustomerPaymentView } from '../customer-payments';

/**
 * H2 Cashfree platform boundary regressions.
 *
 * The extensionless './cashfree-native' specifier resolves per-platform: under
 * jest-expo's iOS-default haste it maps to cashfree-native.native.ts (the real
 * SDK wrapper). The fallback contracts are therefore executed by requiring the
 * exact fallback FILENAMES, which is how Expo web bundling reaches them.
 */
jest.mock('../cashfree-native', () => ({
  openCashfreeNativeCheckout: jest.fn(),
}));

// waitForPaymentOutcome's recovery path re-initiates the canonical payment,
// whose idempotency key defaults to Crypto.randomUUID().
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'd4c1a2b6-0000-4000-8000-000000000042'),
}));

const checkoutSpy = openCashfreeNativeCheckout as jest.Mock;
let getSpy: jest.Mock;
let postSpy: jest.Mock;

const validPayment: CustomerPaymentView = {
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

describe('H2 Cashfree platform fallback modules execute and refuse', () => {
  const webModule =
    jest.requireActual<typeof import('../cashfree-native.web')>('../cashfree-native.web');
  const baseModule =
    jest.requireActual<typeof import('../cashfree-native.ts')>('../cashfree-native.ts');

  beforeEach(() => {
    checkoutSpy.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('web fallback rejects checkout instead of resolving any success-like signal', async () => {
    await expect(
      webModule.openCashfreeNativeCheckout({ paymentSessionId: 'session-1', providerOrderId: 'ma_123' }),
    ).rejects.toThrow('Cashfree checkout is not supported by the MyPet web client.');
  });

  it('base fallback rejects checkout outside Android/iOS instead of resolving a signal', async () => {
    await expect(
      baseModule.openCashfreeNativeCheckout({ paymentSessionId: 'session-1', providerOrderId: 'ma_123' }),
    ).rejects.toThrow('Cashfree native checkout is only available on Android and iOS.');
  });
});

describe('H2 openCashfreeOrder surfaces platform crashes as failures', () => {
  let setItemSpy: jest.Mock;
  let removeItemSpy: jest.Mock;

  beforeEach(() => {
    checkoutSpy.mockReset();
    getSpy = jest.spyOn(apiClient, 'get') as unknown as jest.Mock;
    getSpy.mockReset();
    postSpy = jest.spyOn(apiClient, 'post') as unknown as jest.Mock;
    postSpy.mockReset();
    setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
    removeItemSpy = jest.spyOn(AsyncStorage, 'removeItem');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('rejects an incomplete checkout session before ever touching the platform module', async () => {
    await expect(
      openCashfreeOrder({ ...validPayment, paymentSessionId: null }),
    ).rejects.toThrow('Cashfree returned an invalid checkout session.');
    await expect(
      openCashfreeOrder({ ...validPayment, providerOrderId: '' }),
    ).rejects.toThrow('Cashfree returned an invalid checkout session.');

    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  it('propagates a platform-module crash as a rejection (never an ERROR resolve or success)', async () => {
    const crash = new Error('Cashfree SDK bridge crashed');
    checkoutSpy.mockRejectedValueOnce(crash);

    // Truthful contract: openCashfreeOrder itself does NOT swallow crashes; callers wrap with .catch(() => 'ERROR').
    await expect(openCashfreeOrder(validPayment)).rejects.toThrow('Cashfree SDK bridge crashed');

    expect(checkoutSpy).toHaveBeenCalledTimes(1);
    expect(checkoutSpy).toHaveBeenCalledWith({
      paymentSessionId: 'session-1',
      providerOrderId: 'ma_123',
    });

    // A crash must not write or clear any payment-recovery state.
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it('reduces a platform crash during session recovery to an ERROR signal and keeps polling the backend', async () => {
    const crash = new Error('Cashfree SDK bridge crashed');
    checkoutSpy.mockRejectedValue(crash);
    let statusRead = 0;
    getSpy.mockImplementation(async () => {
      statusRead += 1;
      // A durable payment without a provider session forces canonical re-initiation.
      return statusRead === 1 ? { ...validPayment, paymentSessionId: null } : { ...validPayment };
    });
    postSpy.mockResolvedValue({ ...validPayment });

    jest.useFakeTimers();
    const outcomePromise = waitForPaymentOutcome('payment-1', 3, 1_000);
    await jest.advanceTimersByTimeAsync(2_500);
    const outcome = await outcomePromise;

    // The SDK crash was caught into a local ERROR signal; verification continued
    // and the outcome stayed PENDING because the BACKEND never reported terminal state.
    expect(outcome.status).toBe('PENDING');
    expect(checkoutSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/customer/payments',
      { referenceType: 'PRODUCT_ORDER', referenceId: 'order-1', provider: 'CASHFREE' },
      { 'Idempotency-Key': 'd4c1a2b6-0000-4000-8000-000000000042' },
    );
    // Initial status + recovery refetch + two bounded polls.
    expect(getSpy).toHaveBeenCalledTimes(4);

    // Pending payments keep their recovery record: no success side effect occurred.
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it('never touches the platform SDK while the backend still reports a live provider session', async () => {
    getSpy.mockResolvedValue({ ...validPayment, status: 'PENDING' });

    jest.useFakeTimers();
    const outcomePromise = waitForPaymentOutcome('payment-1', 3, 1_000);
    await jest.advanceTimersByTimeAsync(2_500);
    const outcome = await outcomePromise;

    expect(outcome.status).toBe('PENDING');
    expect(checkoutSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(getSpy).toHaveBeenCalledTimes(3);
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it('only clears the pending-payment record once the BACKEND itself reports a terminal status', async () => {
    checkoutSpy.mockRejectedValue(new Error('Cashfree SDK bridge crashed'));
    let statusRead = 0;
    getSpy.mockImplementation(async () => {
      statusRead += 1;
      return statusRead === 1 ? { ...validPayment } : { ...validPayment, status: 'CAPTURED' };
    });

    jest.useFakeTimers();
    const outcomePromise = waitForPaymentOutcome('payment-1', 3, 1_000);
    await jest.advanceTimersByTimeAsync(2_500);
    const outcome = await outcomePromise;

    expect(outcome.status).toBe('CAPTURED');
    expect(removeItemSpy).toHaveBeenCalledWith('mypet.customer.pending-payment.v1');
  });
});
