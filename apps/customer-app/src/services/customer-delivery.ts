import type { OrderFlowStepId } from '@/constants/content';
import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import type { OrderStatus } from '@/contracts/order-contract.generated';
import { apiClient } from '@/services/api-client';

export interface DeliveryQuoteInput {
  outletId: string;
  addressId: string;
  lines: Array<{ listingId: string; quantity: number }>;
  paymentMethod?: CustomerPaymentMethod;
}

export interface DeliveryQuote {
  id: string;
  customerId: string;
  outletId: string;
  cartSignature: string;
  fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY';
  paymentMethod: CustomerPaymentMethod;
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
  const expectedPaymentMethod = input.paymentMethod ?? 'PAY_ON_FULFILMENT';

  const quote = await apiClient.post<DeliveryQuote>(
    '/api/v1/customer/quotes/delivery',
    { ...input, paymentMethod: expectedPaymentMethod },
  );

  if (
    quote.fulfilmentMode !== 'MYPET_CAPTAIN_DELIVERY' ||
    quote.paymentMethod !== expectedPaymentMethod ||
    quote.pricing.currency !== 'INR' ||
    !Number.isSafeInteger(quote.pricing.grandTotalPaise) ||
    quote.pricing.grandTotalPaise < 0 ||
    !Number.isSafeInteger(quote.pricing.deliveryFeePaise) ||
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
  );
}
