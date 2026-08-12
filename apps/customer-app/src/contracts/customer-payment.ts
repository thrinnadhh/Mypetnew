import type { PaymentStatus } from './order-contract.generated';

export type CustomerPaymentMethod = 'COD' | 'CARD' | 'UPI';

// Transaction/gateway UI state. This is deliberately separate from the canonical
// order payment status generated from contracts/order-lifecycle.json.
export type CustomerPaymentStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type CustomerOrderPaymentStatus = PaymentStatus;

export interface CustomerPaymentState {
  orderId: string;
  transactionId?: string;
  status: CustomerPaymentStatus;
}

export function shouldPollPayment(status: CustomerPaymentStatus): boolean {
  return status === 'PENDING';
}

export function paymentAllowsCartClear(status: CustomerPaymentStatus): boolean {
  return status === 'SUCCESS';
}

export function paymentNeedsRetry(status: CustomerPaymentStatus): boolean {
  return status === 'FAILED' || status === 'EXPIRED' || status === 'NOT_STARTED';
}

export function isTerminalOrderStatus(status: string): boolean {
  return ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(status.toUpperCase());
}

export function activeOrderPollInterval(status: string): number | null {
  return isTerminalOrderStatus(status) ? null : 8_000;
}
