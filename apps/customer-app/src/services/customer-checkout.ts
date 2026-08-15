import { apiClient } from '@/services/api-client';

export type ProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';

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
  paymentMethod: 'PAY_ON_FULFILMENT';
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION' | string;
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
  fulfilmentMode: string;
  status: string;
}

export async function createProductOrder(
  input: CreateProductOrderInput,
  expectedFulfilmentMode: ProductFulfilmentMode,
  accessToken?: string | null,
): Promise<CreatedProductOrder> {
  if (!accessToken) throw new Error('Sign in before placing an order.');
  if (!input.quoteId || !input.cartSignature) {
    throw new Error('Request a fresh checkout quote before placing the order.');
  }

  const order = await apiClient.post<ProductOrderDto>(
    '/api/v1/customer/orders',
    { quoteId: input.quoteId, cartSignature: input.cartSignature },
    {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': `checkout:${input.quoteId}`,
    },
  );

  if (
    order.quoteId !== input.quoteId ||
    order.fulfilmentMode !== expectedFulfilmentMode ||
    order.paymentMethod !== 'PAY_ON_FULFILMENT' ||
    order.status !== 'PLACED'
  ) {
    throw new Error('Order service returned an unsupported canonical checkout contract.');
  }
  if (!Number.isFinite(order.grandTotalPaise) || order.grandTotalPaise < 0) {
    throw new Error('Order service returned invalid server pricing.');
  }

  return {
    ...order,
    paymentMethod: 'PAY_ON_FULFILMENT',
    fulfilmentMode: expectedFulfilmentMode,
  };
}

export async function createPickupOrder(
  input: CreatePickupOrderInput,
  accessToken?: string | null,
): Promise<CreatedPickupOrder> {
  const order = await createProductOrder(input, 'STORE_PICKUP', accessToken);
  return { ...order, fulfilmentMode: 'STORE_PICKUP' };
}
