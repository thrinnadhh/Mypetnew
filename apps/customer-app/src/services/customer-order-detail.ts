import type { OrderStatus } from '@/contracts/order-contract.generated';
import { apiClient } from '@/services/api-client';

export interface CustomerOrderDetail {
  orderId: string;
  orderNumber: string;
  outletId: string;
  organizationId: string;
  outletName: string;
  items: Array<{ listingId: string; name?: string | null; quantity: number }>;
  grandTotalPaise: number;
  platformFeePaise: number;
  paymentMethod: 'PAY_ON_FULFILMENT';
  paymentStatus: string;
  fulfilmentMode: 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
  status: OrderStatus;
  placedAt?: string | null;
  statusHistory: Array<{
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    changedAt: string;
    reason?: string | null;
  }>;
}

function validateCanonicalOrder(order: CustomerOrderDetail): CustomerOrderDetail {
  if (
    !['STORE_PICKUP', 'MYPET_CAPTAIN_DELIVERY'].includes(order.fulfilmentMode) ||
    order.paymentMethod !== 'PAY_ON_FULFILMENT'
  ) {
    throw new Error('Order service returned an unsupported canonical order contract.');
  }
  if (!Number.isFinite(order.grandTotalPaise) || order.grandTotalPaise < 0) {
    throw new Error('Order service returned invalid server pricing.');
  }
  return order;
}

export async function fetchCustomerOrderDetail(
  orderId: string,
  accessToken?: string | null,
): Promise<CustomerOrderDetail> {
  if (!accessToken) throw new Error('Sign in before viewing an order.');
  const order = await apiClient.get<CustomerOrderDetail>(
    `/api/v1/customer/orders/${encodeURIComponent(orderId)}`,
    { Authorization: `Bearer ${accessToken}` },
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
    {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': `customer-cancel:${orderId}`,
    },
  );
  return validateCanonicalOrder(order);
}
