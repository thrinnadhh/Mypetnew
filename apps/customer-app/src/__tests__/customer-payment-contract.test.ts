import {
  activeOrderPollInterval,
  isTerminalOrderStatus,
  paymentAllowsCartClear,
  paymentNeedsRetry,
  shouldPollPayment,
} from '../contracts/customer-payment';

describe('customer payment contract', () => {
  it('clears the cart only after server-confirmed capture', () => {
    expect(paymentAllowsCartClear('PENDING')).toBe(false);
    expect(paymentAllowsCartClear('AUTHORIZED')).toBe(false);
    expect(paymentAllowsCartClear('FAILED')).toBe(false);
    expect(paymentAllowsCartClear('CAPTURED')).toBe(true);
  });

  it('polls pending or authorized payments and exposes server failures as retryable', () => {
    expect(shouldPollPayment('PENDING')).toBe(true);
    expect(shouldPollPayment('AUTHORIZED')).toBe(true);
    expect(shouldPollPayment('CAPTURED')).toBe(false);
    expect(paymentNeedsRetry('FAILED')).toBe(true);
    expect(paymentNeedsRetry('EXPIRED')).toBe(true);
    expect(paymentNeedsRetry('CAPTURED')).toBe(false);
  });

  it('stops order polling at terminal states', () => {
    expect(isTerminalOrderStatus('DELIVERED')).toBe(true);
    expect(isTerminalOrderStatus('cancelled')).toBe(true);
    expect(activeOrderPollInterval('READY_FOR_PICKUP')).toBe(8_000);
    expect(activeOrderPollInterval('DELIVERED')).toBeNull();
  });
});
