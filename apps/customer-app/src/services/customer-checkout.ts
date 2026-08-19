import { apiClient } from '@/services/api-client';
import {
  clearRecurringCheckoutHandoff,
  completeRecurringHandoff,
  loadRecurringCheckoutHandoff,
  saveRecurringCheckoutHandoff,
} from '@/services/recurring-handoff';

export type ProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
export type ProductPaymentMethod = 'PAY_ON_FULFILMENT' | 'ONLINE_PAYMENT';

export interface CreatePickupOrderInput {
  quoteId: string;
  cartSignature: string;
}

export type CreateProductOrderInput = CreatePickupOrderInput;

export interface CreatedProductOrder {
  id: string;
  customerId: string;
  outletId: string;
  quoteId: string;
  grandTotalPaise: number;
  platformFeePaise: number;
  paymentMethod: ProductPaymentMethod;
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION' | 'PENDING_ONLINE_PAYMENT' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | string;
  paymentHoldExpiresAt?: string | null;
  fulfilmentMode: ProductFulfilmentMode;
  status: 'PLACED' | string;
}

export type CreatedPickupOrder = CreatedProductOrder & { fulfilmentMode: 'STORE_PICKUP' };

interface ProductOrderDto {
  id: string;
  customerId: string;
  outletId: string;
  quoteId: string;
  grandTotalPaise: number;
  platformFeePaise: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentHoldExpiresAt?: string | null;
  fulfilmentMode: string;
  status: string;
}

async function reconcileRecurringHandoff(order: CreatedProductOrder, checkoutIdempotencyKey: string): Promise<void> {
  const handoff = await loadRecurringCheckoutHandoff(order.customerId);
  if (!handoff) return;
  if (handoff.providerId !== order.outletId || handoff.fulfilmentMode !== order.fulfilmentMode) {
    await clearRecurringCheckoutHandoff(order.customerId);
    return;
  }
  const pending = { ...handoff, orderId: order.id, checkoutIdempotencyKey };
  await saveRecurringCheckoutHandoff(pending);
  try {
    await completeRecurringHandoff(pending);
  } catch {
    // The canonical order already exists. Keep the account-scoped recovery record;
    // the subscriptions surface retries completion without creating another order.
  }
}

export async function createProductOrder(
  input: CreateProductOrderInput,
  expectedFulfilmentMode: ProductFulfilmentMode,
  expectedPaymentMethod: ProductPaymentMethod,
): Promise<CreatedProductOrder> {
  if (!input.quoteId || !input.cartSignature) {
    throw new Error('Request a fresh checkout quote before placing the order.');
  }

  const checkoutIdempotencyKey = `checkout:${input.quoteId}`;
  const order = await apiClient.post<ProductOrderDto>(
    '/api/v1/customer/orders',
    { quoteId: input.quoteId, cartSignature: input.cartSignature },
    { 'Idempotency-Key': checkoutIdempotencyKey },
  );

  if (
    order.quoteId !== input.quoteId ||
    order.fulfilmentMode !== expectedFulfilmentMode ||
    order.paymentMethod !== expectedPaymentMethod ||
    order.status !== 'PLACED'
  ) {
    throw new Error('Order service returned an unsupported canonical checkout contract.');
  }
  if (!Number.isSafeInteger(order.grandTotalPaise) || order.grandTotalPaise < 0) {
    throw new Error('Order service returned invalid server pricing.');
  }
  if (expectedPaymentMethod === 'ONLINE_PAYMENT' && order.paymentStatus !== 'PENDING_ONLINE_PAYMENT') {
    throw new Error('Order service did not create the required online-payment hold.');
  }
  if (expectedPaymentMethod === 'PAY_ON_FULFILMENT' && order.paymentStatus !== 'PENDING_EXTERNAL_COLLECTION') {
    throw new Error('Order service returned an unexpected pay-on-fulfilment projection.');
  }

  const canonical: CreatedProductOrder = {
    ...order,
    paymentMethod: expectedPaymentMethod,
    fulfilmentMode: expectedFulfilmentMode,
  };
  await reconcileRecurringHandoff(canonical, checkoutIdempotencyKey);
  return canonical;
}

export async function createPickupOrder(
  input: CreatePickupOrderInput,
  paymentMethod: ProductPaymentMethod = 'PAY_ON_FULFILMENT',
): Promise<CreatedPickupOrder> {
  const order = await createProductOrder(input, 'STORE_PICKUP', paymentMethod);
  return { ...order, fulfilmentMode: 'STORE_PICKUP' };
}
