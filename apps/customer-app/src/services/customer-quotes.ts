import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import { apiClient } from '@/services/api-client';

export type ProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';

export interface QuoteLineInput {
  listingId: string;
  quantity: number;
}

export interface CanonicalProductQuote {
  id: string;
  customerId: string;
  outletId: string;
  lines: Record<string, [number, number]>;
  cartSignature: string;
  fulfilmentMode: ProductFulfilmentMode;
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
    currency: 'INR';
    ruleVersion: string;
  };
  expiresAt: string;
  etaMinutes?: number | null;
}

export async function fetchPickupQuote(
  outletId: string,
  lines: QuoteLineInput[],
  paymentMethod: CustomerPaymentMethod,
): Promise<CanonicalProductQuote> {
  return validateQuote(
    await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/pickup', {
      outletId,
      lines,
      paymentMethod,
    }),
    'STORE_PICKUP',
    paymentMethod,
  );
}

export async function fetchCaptainDeliveryQuote(
  outletId: string,
  addressId: string,
  lines: QuoteLineInput[],
  paymentMethod: CustomerPaymentMethod,
): Promise<CanonicalProductQuote> {
  if (!addressId) throw new Error('Select a saved delivery address.');
  return validateQuote(
    await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/delivery', {
      outletId,
      addressId,
      lines,
      paymentMethod,
    }),
    'MYPET_CAPTAIN_DELIVERY',
    paymentMethod,
  );
}

function validateQuote(
  quote: CanonicalProductQuote,
  expectedFulfilment: ProductFulfilmentMode,
  expectedPayment: CustomerPaymentMethod,
): CanonicalProductQuote {
  if (
    quote.fulfilmentMode !== expectedFulfilment ||
    quote.paymentMethod !== expectedPayment ||
    quote.pricing.currency !== 'INR' ||
    !Number.isSafeInteger(quote.pricing.grandTotalPaise) ||
    quote.pricing.grandTotalPaise < 0 ||
    !quote.id ||
    !quote.cartSignature
  ) {
    throw new Error('Quote service returned an unsupported canonical checkout contract.');
  }
  return quote;
}
