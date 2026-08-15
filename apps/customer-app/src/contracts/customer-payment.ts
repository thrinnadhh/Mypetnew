import type { PaymentStatus } from './order-contract.generated';

export type CustomerPaymentMethod = 'PAY_ON_FULFILMENT' | 'ONLINE_PAYMENT';
export type CustomerPaymentProvider = 'CASHFREE';
export type CustomerRefundStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

// Canonical server-owned Payment state. A native/browser callback never creates
// one of these states locally; the app only receives them from the backend.
export type CustomerPaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'EXPIRED';

export type CustomerOrderPaymentStatus = PaymentStatus;

export interface CustomerPaymentState {
  orderId: string;
  paymentId?: string;
  status: CustomerPaymentStatus;
  refundStatus?: CustomerRefundStatus | null;
}

export function shouldPollPayment(status: CustomerPaymentStatus): boolean {
  return status === 'PENDING' || status === 'AUTHORIZED';
}

export function paymentAllowsCartClear(status: CustomerPaymentStatus): boolean {
  return status === 'CAPTURED';
}

export function paymentNeedsRetry(status: CustomerPaymentStatus): boolean {
  return status === 'FAILED' || status === 'EXPIRED';
}

export function isTerminalOrderStatus(status: string): boolean {
  return ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(status.toUpperCase());
}

export function activeOrderPollInterval(status: string): number | null {
  return isTerminalOrderStatus(status) ? null : 8_000;
}
