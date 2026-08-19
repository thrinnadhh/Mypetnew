import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiClient } from '@/services/api-client';

export interface RecurringCheckoutHandoff {
  customerId: string;
  subscriptionId: string;
  proposalId: string;
  providerId: string;
  fulfilmentMode: 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
  orderId?: string;
  checkoutIdempotencyKey?: string;
  createdAt: string;
}

const PREFIX = 'mypet_recurring_handoff_v1_customer_';

function key(customerId: string): string {
  return `${PREFIX}${customerId}`;
}

function valid(value: unknown, customerId: string): value is RecurringCheckoutHandoff {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RecurringCheckoutHandoff>;
  return candidate.customerId === customerId
    && typeof candidate.subscriptionId === 'string'
    && typeof candidate.proposalId === 'string'
    && typeof candidate.providerId === 'string'
    && (candidate.fulfilmentMode === 'STORE_PICKUP' || candidate.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY')
    && typeof candidate.createdAt === 'string';
}

export async function saveRecurringCheckoutHandoff(value: RecurringCheckoutHandoff): Promise<void> {
  await AsyncStorage.setItem(key(value.customerId), JSON.stringify(value));
}

export async function loadRecurringCheckoutHandoff(customerId: string): Promise<RecurringCheckoutHandoff | null> {
  const raw = await AsyncStorage.getItem(key(customerId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!valid(parsed, customerId)) {
      await AsyncStorage.removeItem(key(customerId));
      return null;
    }
    return parsed;
  } catch {
    await AsyncStorage.removeItem(key(customerId));
    return null;
  }
}

export async function clearRecurringCheckoutHandoff(customerId: string): Promise<void> {
  await AsyncStorage.removeItem(key(customerId));
}

export async function attachRecurringOrder(
  customerId: string,
  orderId: string,
  checkoutIdempotencyKey: string,
): Promise<RecurringCheckoutHandoff | null> {
  const current = await loadRecurringCheckoutHandoff(customerId);
  if (!current) return null;
  const next = { ...current, orderId, checkoutIdempotencyKey };
  await saveRecurringCheckoutHandoff(next);
  return next;
}

export async function completeRecurringHandoff(
  handoff: RecurringCheckoutHandoff,
): Promise<boolean> {
  if (!handoff.orderId || !handoff.checkoutIdempotencyKey) return false;
  await apiClient.post(
    `/api/v1/customer/recurring-orders/${encodeURIComponent(handoff.subscriptionId)}/proposals/${encodeURIComponent(handoff.proposalId)}/complete`,
    { orderId: handoff.orderId },
    { 'Idempotency-Key': handoff.checkoutIdempotencyKey },
  );
  await clearRecurringCheckoutHandoff(handoff.customerId);
  return true;
}
