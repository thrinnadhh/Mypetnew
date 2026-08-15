import type { OrderStatus } from '@/contracts/order-contract.generated';
import { apiClient } from '@/services/api-client';

export type OrderTabCategory = 'active' | 'past' | 'subscription';

export interface CustomerOrderSummaryRecord {
  id: string;
  providerId: string;
  providerName: string;
  itemCount: number;
  total: string;
  rawTotal: number;
  status: OrderStatus;
  orderedAt: string;
  lastUpdatedAt: string;
  fulfilmentMode: string;
  paymentMethod: string;
  paymentStatus: string;
  isSubscription: false;
}

interface CustomerOrderSummaryDto {
  orderId: string;
  outlet: {
    id: string;
    name: string;
  };
  itemCount: number;
  grandTotalPaise: number;
  fulfilmentMode: string;
  paymentMethod: string;
  paymentStatus: string;
  status: OrderStatus;
  placedAt: string;
  lastUpdatedAt: string;
}

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export interface CustomerOrderPage {
  items: CustomerOrderSummaryRecord[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

function validatePage(page: PageResponse<CustomerOrderSummaryDto>): PageResponse<CustomerOrderSummaryDto> {
  if (!Number.isInteger(page.page) || page.page < 0) throw new Error('Order service returned an invalid page.');
  if (!Number.isInteger(page.pageSize) || page.pageSize < 1 || page.pageSize > 100) {
    throw new Error('Order service returned an invalid page size.');
  }
  if (!Array.isArray(page.items)) throw new Error('Order service returned invalid order items.');
  return page;
}

function toRecord(order: CustomerOrderSummaryDto): CustomerOrderSummaryRecord {
  if (!order.orderId || !order.outlet?.id || !order.outlet?.name) {
    throw new Error('Order service returned an invalid order summary.');
  }
  if (!Number.isInteger(order.itemCount) || order.itemCount < 0) {
    throw new Error('Order service returned an invalid item count.');
  }
  if (!Number.isFinite(order.grandTotalPaise) || order.grandTotalPaise < 0) {
    throw new Error('Order service returned invalid server pricing.');
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
    fulfilmentMode: order.fulfilmentMode,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    isSubscription: false,
  };
}

export async function fetchCustomerOrderPage(
  accessToken?: string | null,
  page = 0,
  pageSize = 20,
  status?: OrderStatus,
): Promise<CustomerOrderPage> {
  if (!accessToken) throw new Error('Sign in before viewing orders.');
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid order pagination request.');
  }

  const statusQuery = status ? `&status=${encodeURIComponent(status)}` : '';
  const result = validatePage(await apiClient.get<PageResponse<CustomerOrderSummaryDto>>(
    `/api/v1/customer/orders?page=${page}&pageSize=${pageSize}${statusQuery}`,
    { Authorization: `Bearer ${accessToken}` },
  ));

  return {
    items: result.items.map(toRecord),
    page: result.page,
    pageSize: result.pageSize,
    hasNext: result.hasNext,
  };
}
