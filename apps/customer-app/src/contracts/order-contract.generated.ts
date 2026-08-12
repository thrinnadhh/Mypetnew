// GENERATED FROM contracts/order-lifecycle.json. DO NOT EDIT BY HAND.
export const ORDER_STATUSES = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'COD_PENDING', 'COD_COLLECTED', 'REFUND_PENDING', 'REFUNDED'] as const;
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'COD_PENDING' | 'COD_COLLECTED' | 'REFUND_PENDING' | 'REFUNDED';

export const ORDER_ACTORS = ['CUSTOMER', 'MERCHANT', 'DISPATCH', 'CAPTAIN', 'SYSTEM'] as const;
export type OrderActor = 'CUSTOMER' | 'MERCHANT' | 'DISPATCH' | 'CAPTAIN' | 'SYSTEM';

export const ORDER_TRANSITIONS = [
  { actor: 'CUSTOMER', from: 'PLACED', to: 'CANCELLED' },
  { actor: 'MERCHANT', from: 'PLACED', to: 'ACCEPTED' },
  { actor: 'MERCHANT', from: 'PLACED', to: 'REJECTED' },
  { actor: 'MERCHANT', from: 'ACCEPTED', to: 'PREPARING' },
  { actor: 'MERCHANT', from: 'ACCEPTED', to: 'CANCELLED' },
  { actor: 'MERCHANT', from: 'PREPARING', to: 'READY_FOR_PICKUP' },
  { actor: 'DISPATCH', from: 'READY_FOR_PICKUP', to: 'ASSIGNED' },
  { actor: 'CAPTAIN', from: 'ASSIGNED', to: 'PICKED_UP' },
  { actor: 'CAPTAIN', from: 'PICKED_UP', to: 'DELIVERED' },
  { actor: 'SYSTEM', from: 'DELIVERED', to: 'COMPLETED' },
] as const;

export const MERCHANT_ORDER_QUEUES = {
  NEW: { statuses: ['PLACED'] as OrderStatus[], paymentStatuses: ['COD_PENDING', 'SUCCESS'] as PaymentStatus[] },
  ACCEPTED: { statuses: ['ACCEPTED'] as OrderStatus[] },
  PREPARING: { statuses: ['PREPARING'] as OrderStatus[] },
  READY: { statuses: ['READY_FOR_PICKUP'] as OrderStatus[] },
  DELIVERY: { statuses: ['ASSIGNED', 'PICKED_UP'] as OrderStatus[] },
  PAST: { statuses: ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'] as OrderStatus[] },
} as const;

export type MerchantOrderQueue = keyof typeof MERCHANT_ORDER_QUEUES;

export function canOrderTransition(currentStatus: OrderStatus, requestedStatus: OrderStatus, actor: OrderActor): boolean {
  return ORDER_TRANSITIONS.some(
    (transition) => transition.actor === actor && transition.from === currentStatus && transition.to === requestedStatus,
  );
}
