import {
  activeOrderPollInterval,
  isTerminalOrderStatus,
  paymentAllowsCartClear,
  paymentNeedsRetry,
  shouldPollPayment,
} from '../contracts/customer-payment';

describe('customer payment contract', () => {
  it('clears the cart only after server-confirmed success', () => {
    expect(paymentAllowsCartClear('PENDING')).toBe(false);
    expect(paymentAllowsCartClear('FAILED')).toBe(false);
    expect(paymentAllowsCartClear('SUCCESS')).toBe(true);
  });

  it('polls only pending payments and exposes retryable failures', () => {
    expect(shouldPollPayment('PENDING')).toBe(true);
    expect(shouldPollPayment('SUCCESS')).toBe(false);
    expect(paymentNeedsRetry('NOT_STARTED')).toBe(true);
    expect(paymentNeedsRetry('FAILED')).toBe(true);
    expect(paymentNeedsRetry('SUCCESS')).toBe(false);
  });

  it('stops order polling at terminal states', () => {
    expect(isTerminalOrderStatus('DELIVERED')).toBe(true);
    expect(isTerminalOrderStatus('cancelled')).toBe(true);
    expect(activeOrderPollInterval('READY_FOR_PICKUP')).toBe(8_000);
    expect(activeOrderPollInterval('DELIVERED')).toBeNull();
  });
});
