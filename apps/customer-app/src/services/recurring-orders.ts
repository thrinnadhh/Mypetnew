import {
  type RecurringCadence,
  type RecurringOrderConfirmation,
  type RecurringOrderSubscription,
} from '@/contracts/recurring-orders';
import { apiErrorFromResponse } from '@/contracts/api-error';
import { appConfig } from '@/utils/app-config';

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

const PAGE_SIZE = 20;
const MAX_PAGES = 50;

async function request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return (await response.json()) as T;
}

export async function fetchRecurringOrders(accessToken: string): Promise<RecurringOrderSubscription[]> {
  const unique = new Map<string, RecurringOrderSubscription>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await request<PageResponse<RecurringOrderSubscription>>(
      `/api/v1/customer/recurring-orders?page=${page}&pageSize=${PAGE_SIZE}`,
      accessToken,
    );
    if (!Array.isArray(payload.items) || payload.page !== page || !Number.isInteger(payload.pageSize) || payload.pageSize <= 0) {
      throw new Error('Recurring-order service returned an invalid response.');
    }
    payload.items.forEach((item) => unique.set(item.subscriptionId, item));
    if (!payload.hasNext) return [...unique.values()];
  }
  throw new Error('Recurring-order history exceeded the supported bounded pagination window.');
}

export function createRecurringOrder(
  sourceOrderId: string,
  cadenceDays: RecurringCadence,
  quantityMultiplier: number,
  accessToken: string,
): Promise<RecurringOrderSubscription> {
  return request('/api/v1/customer/recurring-orders', accessToken, {
    method: 'POST',
    body: JSON.stringify({ sourceOrderId, cadenceDays, quantityMultiplier }),
  });
}

export function updateRecurringOrder(
  subscriptionId: string,
  action: 'PAUSE' | 'RESUME' | 'SKIP' | 'CANCEL' | 'CHANGE',
  accessToken: string,
  changes: { cadenceDays?: RecurringCadence; quantityMultiplier?: number; deliveryAddressId?: string } = {},
): Promise<RecurringOrderSubscription> {
  return request(`/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ action, ...changes }),
  });
}

export function confirmRecurringOrder(
  subscriptionId: string,
  accessToken: string,
): Promise<RecurringOrderConfirmation> {
  return request(`/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}/confirm`, accessToken, { method: 'POST' });
}
