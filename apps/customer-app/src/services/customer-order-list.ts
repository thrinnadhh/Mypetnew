import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import type { OrderStatus } from '@/contracts/order-contract.generated';
import { apiClient } from '@/services/api-client';

export type OrderTabCategory = 'active' | 'past';
export type CustomerProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
export type CustomerProductOrderStatus = Exclude<OrderStatus, 'ASSIGNED' | 'COMPLETED'>;

export interface CustomerOrderCursor {
  placedAt: string;
  orderId: string;
}

export interface CustomerOrderSummaryRecord {
  id: string;
  providerId: string;
  providerName: string;
  itemCount: number;
  total: string;
  rawTotal: number;
  status: CustomerProductOrderStatus;
  orderedAt: string;
  lastUpdatedAt: string;
  fulfilmentMode: CustomerProductFulfilmentMode;
  paymentMethod: CustomerPaymentMethod;
  paymentStatus: string;
}

interface CustomerOrderSummaryDto {
  orderId: string;
  outlet: { id: string; name: string };
  itemCount: number;
  grandTotalPaise: number;
  fulfilmentMode: string;
  paymentMethod: string;
  paymentStatus: string;
  status: CustomerProductOrderStatus;
  placedAt: string;
  lastUpdatedAt: string;
}

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
  nextCursor?: CustomerOrderCursor | null;
}

export interface CustomerOrderPage {
  items: CustomerOrderSummaryRecord[];
  page: number;
  pageSize: number;
  hasNext: boolean;
  nextCursor: CustomerOrderCursor | null;
}

function validatePage(page: PageResponse<CustomerOrderSummaryDto>): PageResponse<CustomerOrderSummaryDto> {
  if (!Number.isInteger(page.page) || page.page < 0) throw new Error('Order service returned an invalid page.');
  if (!Number.isInteger(page.pageSize) || page.pageSize < 1 || page.pageSize > 100) {
    throw new Error('Order service returned an invalid page size.');
  }
  if (!Array.isArray(page.items)) throw new Error('Order service returned invalid order items.');
  if (page.hasNext && (!page.nextCursor?.placedAt || !page.nextCursor.orderId)) {
    throw new Error('Order service returned an invalid pagination cursor.');
  }
  return page;
}

function toRecord(order: CustomerOrderSummaryDto): CustomerOrderSummaryRecord {
  if (!order.orderId || !order.outlet?.id || !order.outlet?.name) {
    throw new Error('Order service returned an invalid order summary.');
  }
  if (!Number.isSafeInteger(order.itemCount) || order.itemCount < 0) {
    throw new Error('Order service returned an invalid item count.');
  }
  if (!Number.isSafeInteger(order.grandTotalPaise) || order.grandTotalPaise < 0) {
    throw new Error('Order service returned invalid server pricing.');
  }
  if (!['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(order.status)) {
    throw new Error('Order service returned an unsupported order status.');
  }
  const fulfilmentMode = order.fulfilmentMode as CustomerProductFulfilmentMode;
  const paymentMethod = order.paymentMethod as CustomerPaymentMethod;
  if (
    !['STORE_PICKUP', 'MYPET_CAPTAIN_DELIVERY'].includes(fulfilmentMode) ||
    !['PAY_ON_FULFILMENT', 'ONLINE_PAYMENT'].includes(paymentMethod)
  ) {
    throw new Error('Order service returned an unsupported canonical order contract.');
  }

  const rawTotal = order.grandTotalPaise / 100;
  return {
    id: order.orderId,
    providerId: order.outlet.id,
    providerName: order.outlet.name,
    itemCount: order.itemCount,
    total: `₹${rawTotal.toFixed(0)}`,
    rawTotal,
    status: order.status,
    orderedAt: order.placedAt,
    lastUpdatedAt: order.lastUpdatedAt,
    fulfilmentMode,
    paymentMethod,
    paymentStatus: order.paymentStatus,
  };
}

export async function fetchCustomerOrderPage(
  accessToken?: string | null,
  page = 0,
  pageSize = 20,
  category: OrderTabCategory = 'active',
  cursor?: CustomerOrderCursor | null,
): Promise<CustomerOrderPage> {
  if (!accessToken) throw new Error('Sign in before viewing orders.');
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid order pagination request.');
  }

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    category: category.toUpperCase(),
  });
  if (cursor) {
    params.set('beforePlacedAt', cursor.placedAt);
    params.set('beforeOrderId', cursor.orderId);
  }
  const result = validatePage(await apiClient.get<PageResponse<CustomerOrderSummaryDto>>(
    `/api/v1/customer/orders?${params.toString()}`,
    { Authorization: `Bearer ${accessToken}` },
  ));

  return {
    items: result.items.map(toRecord),
    page: result.page,
    pageSize: result.pageSize,
    hasNext: result.hasNext,
    nextCursor: result.nextCursor ?? null,
  };
}
