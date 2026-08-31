import * as Crypto from 'expo-crypto';
import { merchantApiFetch } from '../auth/session';

export type MerchantOrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'REJECTED'
  | 'CANCELLED';

export type MerchantOrderWorkItem = {
  orderId: string;
  orderNumber: string;
  outletId: string;
  status: MerchantOrderStatus;
  fulfilmentMode: string;
  grandTotalPaise: number;
  paymentStatus: string;
  createdAt: string;
};

export type MerchantOrderWorkPage = {
  items: MerchantOrderWorkItem[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  const error = new Error(body?.message ?? fallback);
  error.name = body?.code ?? 'MERCHANT_API_ERROR';
  return error;
}

function isOrder(value: unknown): value is MerchantOrderWorkItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<MerchantOrderWorkItem>;
  return typeof v.orderId === 'string'
    && typeof v.orderNumber === 'string'
    && typeof v.outletId === 'string'
    && typeof v.status === 'string'
    && ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(v.status)
    && typeof v.fulfilmentMode === 'string'
    && typeof v.grandTotalPaise === 'number'
    && Number.isFinite(v.grandTotalPaise)
    && v.grandTotalPaise >= 0
    && typeof v.paymentStatus === 'string'
    && typeof v.createdAt === 'string';
}

export async function fetchMerchantOrderWork(outletId?: string): Promise<MerchantOrderWorkPage> {
  const params = new URLSearchParams({ page: '0', pageSize: '50' });
  if (outletId) params.set('outletId', outletId);
  const response = await merchantApiFetch(`/api/v1/merchant/order-work?${params.toString()}`);
  if (!response.ok) throw await apiError(response, 'Could not load order work.');
  const page: unknown = await response.json();
  if (!page || typeof page !== 'object') throw new Error('MERCHANT_ORDER_WORK_INVALID');
  const candidate = page as Partial<MerchantOrderWorkPage>;
  if (!Array.isArray(candidate.items) || !candidate.items.every(isOrder)) throw new Error('MERCHANT_ORDER_WORK_INVALID');
  if (
    !Number.isInteger(candidate.page) || (candidate.page as number) < 0
    || !Number.isInteger(candidate.pageSize) || (candidate.pageSize as number) < 1 || (candidate.pageSize as number) > 100
    || typeof candidate.hasNext !== 'boolean'
  ) {
    throw new Error('MERCHANT_ORDER_WORK_INVALID');
  }
  return candidate as MerchantOrderWorkPage;
}

export function orderTargets(order: MerchantOrderWorkItem): MerchantOrderStatus[] {
  switch (order.status) {
    case 'PLACED': return ['ACCEPTED', 'REJECTED'];
    case 'ACCEPTED': return ['PREPARING', 'CANCELLED'];
    case 'PREPARING': return ['READY_FOR_PICKUP', 'CANCELLED'];
    case 'READY_FOR_PICKUP': return order.fulfilmentMode === 'STORE_PICKUP' ? ['PICKED_UP', 'CANCELLED'] : [];
    case 'PICKED_UP': return order.fulfilmentMode === 'STORE_PICKUP' ? ['DELIVERED'] : [];
    default: return [];
  }
}

export async function transitionMerchantOrder(
  order: MerchantOrderWorkItem,
  target: MerchantOrderStatus,
  reason?: string,
): Promise<void> {
  if (!orderTargets(order).includes(target)) throw new Error('ORDER_TRANSITION_INVALID');
  const destructive = target === 'REJECTED' || target === 'CANCELLED';
  const normalizedReason = reason?.trim();
  if (destructive && !normalizedReason) throw new Error('ORDER_REASON_REQUIRED');
  const response = await merchantApiFetch(`/api/v1/merchant/orders/${encodeURIComponent(order.orderId)}/transitions`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `m11-order:${Crypto.randomUUID()}` },
    body: JSON.stringify({ target, ...(normalizedReason ? { reason: normalizedReason } : {}) }),
  });
  if (!response.ok) throw await apiError(response, 'Could not update this order.');
}
