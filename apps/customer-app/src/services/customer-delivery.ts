import type { OrderFlowStepId } from '@/constants/content';
import type { OrderStatus } from '@/contracts/order-contract.generated';
import { apiClient } from '@/services/api-client';

export interface DeliveryQuoteInput {
  outletId: string;
  addressId: string;
  lines: Array<{ listingId: string; quantity: number }>;
}

export interface DeliveryQuote {
  id: string;
  customerId: string;
  outletId: string;
  cartSignature: string;
  fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY';
  paymentMethod: 'PAY_ON_FULFILMENT';
  pricing: {
    itemSubtotalPaise: number;
    itemDiscountPaise: number;
    couponDiscountPaise: number;
    loyaltyRewardPaise: number;
    taxPaise: number;
    platformFeePaise: number;
    deliveryFeePaise: number;
    merchantCommissionPaise: number;
    grandTotalPaise: number;
    currency: string;
    ruleVersion: string;
  };
  expiresAt: string;
  etaMinutes: number;
}

export interface CustomerOrderTracking {
  orderId: string;
  status: OrderStatus;
  flowStep: OrderFlowStepId | 'cancelled';
  paymentStatus: string;
  fulfilmentMode: 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
  captain?: {
    captainId: string;
    assignedAt?: string | null;
  } | null;
  etaMinutes?: number | null;
  deliveryStatus?: string | null;
  lastLocation?: {
    latitude: number;
    longitude: number;
    observedAt: string;
  } | null;
}

export async function fetchDeliveryQuote(
  input: DeliveryQuoteInput,
  accessToken?: string | null,
): Promise<DeliveryQuote> {
  if (!accessToken) throw new Error('Sign in before requesting delivery.');
  if (!input.addressId) throw new Error('Select a saved delivery address.');

  const quote = await apiClient.post<DeliveryQuote>(
    '/api/v1/customer/quotes/delivery',
    input,
    { Authorization: `Bearer ${accessToken}` },
  );

  if (
    quote.fulfilmentMode !== 'MYPET_CAPTAIN_DELIVERY' ||
    quote.paymentMethod !== 'PAY_ON_FULFILMENT' ||
    quote.pricing.currency !== 'INR' ||
    !Number.isFinite(quote.pricing.grandTotalPaise) ||
    !Number.isFinite(quote.pricing.deliveryFeePaise) ||
    !Number.isFinite(quote.etaMinutes)
  ) {
    throw new Error('Delivery quote service returned an unsupported contract.');
  }
  return quote;
}

export async function fetchCustomerOrderTracking(
  orderId: string,
  accessToken?: string | null,
): Promise<CustomerOrderTracking> {
  if (!accessToken) throw new Error('Sign in to track this order.');
  return apiClient.get<CustomerOrderTracking>(
    `/api/v1/customer/orders/${encodeURIComponent(orderId)}/tracking`,
    { Authorization: `Bearer ${accessToken}` },
  );
}
