import { ApiError } from '@/contracts/api-error';
import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import type { ProductFulfilmentMode } from '@/services/customer-checkout';

export interface CheckoutRequestLine {
  offeringId: string;
  quantity: number;
}

export interface CheckoutRequestState {
  customerId: string;
  providerId: string;
  lines: readonly CheckoutRequestLine[];
  fulfilmentMode: ProductFulfilmentMode;
  paymentMethod: CustomerPaymentMethod;
  selectedAddressId: string | null;
  selectedPincode: string;
}

export type CheckoutRecovery = 'retry' | 'cart' | 'address' | 'fulfilment' | 'payment';

export interface CheckoutErrorPresentation {
  message: string;
  recovery: CheckoutRecovery;
}

export function buildCheckoutRequestKey(input: CheckoutRequestState): string {
  const lines = [...input.lines]
    .sort((left, right) => left.offeringId.localeCompare(right.offeringId))
    .map((line) => `${line.offeringId}:${line.quantity}`)
    .join('|');
  return [
    input.customerId,
    input.providerId,
    input.fulfilmentMode,
    input.paymentMethod,
    input.selectedAddressId ?? '-',
    input.selectedPincode,
    lines,
  ].join('::');
}

export function isQuoteExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= nowMs;
}

export function hasServerPriceChange(localSubtotalRupees: number, serverSubtotalPaise: number): boolean {
  if (!Number.isFinite(localSubtotalRupees) || !Number.isSafeInteger(serverSubtotalPaise)) return true;
  return Math.round(localSubtotalRupees * 100) !== serverSubtotalPaise;
}

export function checkoutErrorPresentation(error: unknown): CheckoutErrorPresentation {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'LISTING_UNAVAILABLE':
      case 'CART_INVALID':
      case 'CART_EMPTY':
        return {
          message: 'One or more cart items changed or became unavailable. Return to cart, review the affected items, and quote again.',
          recovery: 'cart',
        };
      case 'OUTLET_NOT_SERVICEABLE':
      case 'PIN_CODE_INVALID':
        return {
          message: 'This shop cannot serve the selected delivery PIN. Choose a compatible service PIN or delivery address.',
          recovery: 'address',
        };
      case 'DELIVERY_DISPATCH_ORIGIN_REQUIRED':
        return {
          message: 'Captain delivery is not configured for this shop. Choose store pickup if it is available.',
          recovery: 'fulfilment',
        };
      case 'PAYMENT_PROVIDER_UNAVAILABLE':
        return {
          message: 'Online payment is temporarily unavailable. Choose pay on fulfilment and request a fresh quote.',
          recovery: 'payment',
        };
      default:
        return { message: error.message, recovery: 'retry' };
    }
  }
  if (error instanceof TypeError) {
    return {
      message: 'Checkout needs a network connection for authoritative pricing and stock. Reconnect and retry; your cart is preserved.',
      recovery: 'retry',
    };
  }
  return {
    message: error instanceof Error ? error.message : 'Could not load checkout quote.',
    recovery: 'retry',
  };
}

export function requiresFreshQuote(error: unknown): boolean {
  return error instanceof ApiError && [
    'QUOTE_EXPIRED',
    'QUOTE_STALE',
    'QUOTE_NOT_FOUND',
    'LISTING_UNAVAILABLE',
  ].includes(error.code);
}
