import { apiClient } from '@/services/api-client';

export interface CreatePickupOrderInput {
  quoteId: string;
  cartSignature: string;
}

export interface CreatedPickupOrder {
  id: string;
  customerId: string;
  outletId: string;
  quoteId: string;
  grandTotalPaise: number;
  platformFeePaise: number;
  paymentMethod: 'PAY_ON_FULFILMENT';
  paymentStatus: 'PENDING_EXTERNAL_COLLECTION' | string;
  fulfilmentMode: 'STORE_PICKUP';
  status: 'PLACED' | string;
}

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

export async function createPickupOrder(
  input: CreatePickupOrderInput,
  accessToken?: string | null,
): Promise<CreatedPickupOrder> {
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
    order.fulfilmentMode !== 'STORE_PICKUP' ||
    order.paymentMethod !== 'PAY_ON_FULFILMENT' ||
    order.status !== 'PLACED'
  ) {
    throw new Error('Order service returned an unsupported Sprint-1 checkout contract.');
  }
  if (!Number.isFinite(order.grandTotalPaise) || order.grandTotalPaise < 0) {
    throw new Error('Order service returned invalid server pricing.');
  }

  return {
    ...order,
    paymentMethod: 'PAY_ON_FULFILMENT',
    fulfilmentMode: 'STORE_PICKUP',
  };
}
