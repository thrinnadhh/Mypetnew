import { merchantApiFetch } from '../auth/session';

export type MerchantOrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';

export type FulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';

export interface MerchantOrderLine {
  listingId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  totalPaise: number;
}

export interface MerchantOrderSummary {
  orderId: string;
  outletId: string;
  displayNumber: string;
  status: MerchantOrderStatus;
  fulfilmentMode: FulfilmentMode;
  totalPaise: number;
  lines: MerchantOrderLine[];
  customerPhoneMasked?: string;
  deliveryAddressSummary?: string | null;
  placedAt: string;
}

export async function fetchMerchantOrders(outletId: string): Promise<MerchantOrderSummary[]> {
  const response = await merchantApiFetch(`/api/v1/merchant/outlets/${outletId}/orders`);
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Could not load orders: ${response.status}`);
  }
  const data = await response.json();
  const items = Array.isArray(data) ? data : data.items ?? [];
  return items.map((order: any) => ({
    orderId: order.id ?? order.orderId,
    outletId: order.outletId,
    displayNumber: order.displayNumber ?? `#MP-${(order.id ?? '').slice(0, 6).toUpperCase()}`,
    status: order.status,
    fulfilmentMode: order.fulfilmentMode ?? 'STORE_PICKUP',
    totalPaise: order.totalPaise ?? order.totalAmountPaise ?? 0,
    lines: (order.lines ?? []).map((l: any) => ({
      listingId: l.listingId,
      name: l.name ?? l.listingName ?? 'Product',
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise ?? l.pricePaise ?? 0,
      totalPaise: (l.quantity ?? 1) * (l.unitPricePaise ?? l.pricePaise ?? 0),
    })),
    customerPhoneMasked: order.customerPhoneMasked,
    deliveryAddressSummary: order.deliveryAddress?.formattedAddress ?? order.deliveryAddressSummary,
    placedAt: order.createdAt ?? order.placedAt ?? new Date().toISOString(),
  }));
}

export async function transitionOrderStatus(
  orderId: string,
  targetStatus: MerchantOrderStatus,
  reason: string | null,
  idempotencyKey: string,
): Promise<void> {
  const response = await merchantApiFetch(`/api/v1/merchant/orders/${orderId}/transitions`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target: targetStatus,
      reason,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `Order transition failed: ${response.status}`);
  }
}
