import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import type { OrderStatus } from '@/contracts/order-contract.generated';
import { apiClient } from '@/services/api-client';
import type { CustomerProductFulfilmentMode, CustomerProductOrderStatus } from '@/services/customer-order-list';

export interface CustomerOrderDetail {
  orderId: string;
  orderNumber: string;
  outlet: { id: string; name: string };
  items: Array<{
    listingId: string;
    name: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
  pricing: {
    itemSubtotalPaise: number;
    itemDiscountPaise: number;
    couponDiscountPaise: number;
    loyaltyRewardPaise: number;
    taxPaise: number;
    platformFeePaise: number;
    deliveryFeePaise: number;
    grandTotalPaise: number;
    currency: string;
  };
  paymentMethod: CustomerPaymentMethod;
  paymentStatus: string;
  fulfilmentMode: CustomerProductFulfilmentMode;
  status: CustomerProductOrderStatus;
  placedAt?: string | null;
  statusHistory: Array<{
    fromStatus: OrderStatus | null;
    toStatus: CustomerProductOrderStatus;
    changedAt: string;
    reason?: string | null;
  }>;
  deliveryAddress?: {
    addressId: string;
    recipientName: string;
    phoneNumber: string;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
  } | null;
  canCancel: boolean;
  cancellation: {
    cancelled: boolean;
    reason?: string | null;
    cancelledAt?: string | null;
  };
}

function validNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateCanonicalOrder(order: CustomerOrderDetail): CustomerOrderDetail {
  if (
    !['STORE_PICKUP', 'MYPET_CAPTAIN_DELIVERY'].includes(order.fulfilmentMode) ||
    !['PAY_ON_FULFILMENT', 'ONLINE_PAYMENT'].includes(order.paymentMethod) ||
    !['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(order.status)
  ) {
    throw new Error('Order service returned an unsupported canonical order contract.');
  }
  if (
    !validNonNegativeInteger(order.pricing.itemSubtotalPaise) ||
    !validNonNegativeInteger(order.pricing.itemDiscountPaise) ||
    !validNonNegativeInteger(order.pricing.couponDiscountPaise) ||
    !validNonNegativeInteger(order.pricing.loyaltyRewardPaise) ||
    !validNonNegativeInteger(order.pricing.taxPaise) ||
    !validNonNegativeInteger(order.pricing.platformFeePaise) ||
    !validNonNegativeInteger(order.pricing.deliveryFeePaise) ||
    !validNonNegativeInteger(order.pricing.grandTotalPaise) ||
    order.pricing.currency !== 'INR'
  ) {
    throw new Error('Order service returned invalid server pricing.');
  }
  if (!Array.isArray(order.items) || order.items.some((item) => (
    !item.listingId || !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 ||
    !validNonNegativeInteger(item.unitPricePaise) || !validNonNegativeInteger(item.lineTotalPaise) ||
    item.lineTotalPaise !== item.unitPricePaise * item.quantity
  ))) {
    throw new Error('Order service returned invalid historical order items.');
  }
  if (order.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' && !order.deliveryAddress) {
    throw new Error('Order service returned delivery without its order-time address snapshot.');
  }
  return order;
}

function cancellationIntentKey(orderId: string, reason: string): string {
  let hash = 2166136261;
  for (let index = 0; index < reason.length; index += 1) {
    hash ^= reason.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `customer-cancel:${orderId}:${(hash >>> 0).toString(16)}`;
}

export async function fetchCustomerOrderDetail(
  orderId: string,
  accessToken?: string | null,
): Promise<CustomerOrderDetail> {
  if (!accessToken) throw new Error('Sign in before viewing an order.');
  const order = await apiClient.get<CustomerOrderDetail>(
    `/api/v1/customer/orders/${encodeURIComponent(orderId)}`,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not load order details' },
  );
  return validateCanonicalOrder(order);
}

export async function cancelCustomerOrder(
  orderId: string,
  reason: string,
  accessToken?: string | null,
): Promise<CustomerOrderDetail> {
  if (!accessToken) throw new Error('Sign in before cancelling an order.');
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('A cancellation reason is required.');
  const order = await apiClient.post<CustomerOrderDetail>(
    `/api/v1/customer/orders/${encodeURIComponent(orderId)}/cancel`,
    { reason: normalizedReason },
    { 'Idempotency-Key': cancellationIntentKey(orderId, normalizedReason) },
    { authToken: accessToken, errorFallback: 'Could not cancel order' },
  );
  return validateCanonicalOrder(order);
}
