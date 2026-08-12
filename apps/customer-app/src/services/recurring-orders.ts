import {
  type RecurringCadence,
  type RecurringOrderConfirmation,
  type RecurringOrderSubscription,
} from '@/contracts/recurring-orders';
import { apiErrorFromResponse } from '@/contracts/api-error';
import { appConfig } from '@/utils/app-config';

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

export function fetchRecurringOrders(accessToken: string): Promise<RecurringOrderSubscription[]> {
  return request('/api/v1/orders/subscriptions', accessToken);
}

export function createRecurringOrder(
  sourceOrderId: string,
  cadenceDays: RecurringCadence,
  quantityMultiplier: number,
  accessToken: string,
): Promise<RecurringOrderSubscription> {
  return request('/api/v1/orders/subscriptions', accessToken, {
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
  return request(`/api/v1/orders/subscriptions/${subscriptionId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ action, ...changes }),
  });
}

export function confirmRecurringOrder(
  subscriptionId: string,
  accessToken: string,
): Promise<RecurringOrderConfirmation> {
  return request(`/api/v1/orders/subscriptions/${subscriptionId}/confirm`, accessToken, { method: 'POST' });
}
