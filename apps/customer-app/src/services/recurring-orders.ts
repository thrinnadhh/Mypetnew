import {
  type RecurringCadence,
  type RecurringOrderConfirmation,
  type RecurringOrderSubscription,
  type RenewalProposal,
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

async function fetchAllPages<T>(path: string, id: (item: T) => string, accessToken: string): Promise<T[]> {
  const unique = new Map<string, T>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await request<PageResponse<T> | T[]>(
      `${path}${separator}page=${page}&pageSize=${PAGE_SIZE}`,
      accessToken,
    );

    // Historical P14 returned a single bounded array. Accept it only as a terminal
    // one-page compatibility response; current servers must use PageResponse.
    if (Array.isArray(payload)) {
      if (page !== 0) throw new Error('Recurring-order service changed pagination shape mid-request.');
      payload.forEach((item) => unique.set(id(item), item));
      return [...unique.values()];
    }

    if (!Array.isArray(payload.items) || payload.page !== page || payload.pageSize !== PAGE_SIZE) {
      throw new Error('Recurring-order service returned an invalid paginated response.');
    }
    payload.items.forEach((item) => unique.set(id(item), item));
    if (!payload.hasNext) return [...unique.values()];
  }
  throw new Error('Recurring-order history exceeded the supported bounded pagination window.');
}

function compatibilityCommandKey(operation: string, resource: string): string {
  const safeOperation = operation.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 24);
  const safeResource = resource.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 72);
  return `recurring:compat:${safeOperation}:${safeResource}:${Date.now()}`.slice(0, 128);
}

export function fetchRecurringOrders(accessToken: string): Promise<RecurringOrderSubscription[]> {
  return fetchAllPages('/api/v1/customer/recurring-orders', (item: RecurringOrderSubscription) => item.subscriptionId, accessToken);
}

export function fetchRenewalProposals(accessToken: string): Promise<RenewalProposal[]> {
  return fetchAllPages('/api/v1/customer/recurring-orders/proposals', (item: RenewalProposal) => item.proposalId, accessToken);
}

export function fetchRenewalProposal(
  subscriptionId: string,
  proposalId: string,
  accessToken: string,
): Promise<RenewalProposal> {
  return request(
    `/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}/proposals/${encodeURIComponent(proposalId)}`,
    accessToken,
  );
}

export function createRecurringOrder(
  sourceOrderId: string,
  cadenceDays: RecurringCadence,
  quantityMultiplier: number,
  accessToken: string,
  idempotencyKey = compatibilityCommandKey('create', `${sourceOrderId}:${cadenceDays}:${quantityMultiplier}`),
): Promise<RecurringOrderSubscription> {
  return request('/api/v1/customer/recurring-orders', accessToken, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ sourceOrderId, cadenceDays, quantityMultiplier }),
  });
}

export function updateRecurringOrder(
  subscriptionId: string,
  action: 'PAUSE' | 'RESUME' | 'SKIP' | 'SKIP_NEXT' | 'CANCEL' | 'CHANGE',
  accessToken: string,
  idempotencyKey = compatibilityCommandKey(action, subscriptionId),
  changes: { cadenceDays?: RecurringCadence; quantityMultiplier?: number; deliveryAddressId?: string } = {},
): Promise<RecurringOrderSubscription> {
  return request(`/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}`, accessToken, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ action, ...changes }),
  });
}

export function confirmRecurringProposal(
  subscriptionId: string,
  proposalId: string,
  accessToken: string,
  idempotencyKey: string,
): Promise<RecurringOrderConfirmation> {
  return request(
    `/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}/proposals/${encodeURIComponent(proposalId)}/confirm`,
    accessToken,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

/**
 * Historical P14 client compatibility. The backend resolves the customer's current
 * open durable proposal; it does not promote due state and cannot create an order.
 * New code must use confirmRecurringProposal with an explicit proposalId.
 */
export function confirmRecurringOrder(
  subscriptionId: string,
  accessToken: string,
  idempotencyKey = compatibilityCommandKey('confirm', subscriptionId),
): Promise<RecurringOrderConfirmation> {
  return request(`/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}/confirm`, accessToken, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function completeRecurringProposal(
  subscriptionId: string,
  proposalId: string,
  orderId: string,
  accessToken: string,
  checkoutIdempotencyKey: string,
): Promise<RenewalProposal> {
  return request(
    `/api/v1/customer/recurring-orders/${encodeURIComponent(subscriptionId)}/proposals/${encodeURIComponent(proposalId)}/complete`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': checkoutIdempotencyKey },
      body: JSON.stringify({ orderId }),
    },
  );
}

export function recurringCommandKey(
  customerId: string,
  operation: string,
  resourceId: string,
  nonce: string | number,
): string {
  const sanitizedOperation = operation.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 24);
  const sanitizedResource = resourceId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 48);
  const sanitizedCustomer = customerId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 36);
  const sanitizedNonce = String(nonce).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 16);
  return `recurring:${sanitizedOperation}:${sanitizedCustomer}:${sanitizedResource}:${sanitizedNonce}`.slice(0, 128);
}
