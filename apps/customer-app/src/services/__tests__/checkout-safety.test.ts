import { ApiError } from '@/contracts/api-error';
import {
  buildCheckoutRequestKey,
  checkoutErrorPresentation,
  hasServerPriceChange,
  isQuoteExpired,
  requiresFreshQuote,
} from '@/services/checkout-safety';

function apiError(code: string, message = code): ApiError {
  return new ApiError(409, { code, message, fieldErrors: {} });
}

describe('checkout safety helpers', () => {
  it('binds a quote request to customer, cart, fulfilment, payment, address and selected service PIN', () => {
    const base = {
      customerId: '00000000-0000-4000-8000-000000000001',
      providerId: '11111111-1111-4111-8111-111111111111',
      lines: [
        { offeringId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 2 },
        { offeringId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity: 1 },
      ],
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY' as const,
      paymentMethod: 'PAY_ON_FULFILMENT' as const,
      selectedAddressId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      selectedPincode: '517501',
    };

    const canonical = buildCheckoutRequestKey(base);
    expect(buildCheckoutRequestKey({ ...base, lines: [...base.lines].reverse() })).toBe(canonical);
    expect(buildCheckoutRequestKey({ ...base, customerId: '00000000-0000-4000-8000-000000000002' })).not.toBe(canonical);
    expect(buildCheckoutRequestKey({ ...base, selectedPincode: '517502' })).not.toBe(canonical);
    expect(buildCheckoutRequestKey({ ...base, selectedAddressId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })).not.toBe(canonical);
    expect(buildCheckoutRequestKey({ ...base, lines: [{ ...base.lines[0], quantity: 3 }] })).not.toBe(canonical);
  });

  it('treats expired or malformed quote timestamps as stale', () => {
    expect(isQuoteExpired('2026-08-18T12:00:00Z', Date.parse('2026-08-18T12:00:00Z'))).toBe(true);
    expect(isQuoteExpired('2026-08-18T12:00:01Z', Date.parse('2026-08-18T12:00:00Z'))).toBe(false);
    expect(isQuoteExpired('not-a-date')).toBe(true);
  });

  it('detects server price changes against the cart projection', () => {
    expect(hasServerPriceChange(100, 10_000)).toBe(false);
    expect(hasServerPriceChange(100, 11_000)).toBe(true);
  });

  it('maps cart, saved-address and serviceability failures to actionable recovery', () => {
    expect(checkoutErrorPresentation(apiError('LISTING_UNAVAILABLE')).recovery).toBe('cart');
    expect(checkoutErrorPresentation(apiError('ADDRESS_NOT_FOUND')).recovery).toBe('saved-address');
    expect(checkoutErrorPresentation(apiError('OUTLET_NOT_SERVICEABLE')).recovery).toBe('address');
    expect(checkoutErrorPresentation(apiError('DELIVERY_DISPATCH_ORIGIN_REQUIRED')).recovery).toBe('fulfilment');
    expect(checkoutErrorPresentation(apiError('PAYMENT_PROVIDER_UNAVAILABLE')).recovery).toBe('payment');
  });

  it('refreshes only known stale authoritative quotes, preserving timeout replay idempotency', () => {
    expect(requiresFreshQuote(apiError('QUOTE_EXPIRED'))).toBe(true);
    expect(requiresFreshQuote(apiError('QUOTE_STALE'))).toBe(true);
    expect(requiresFreshQuote(apiError('LISTING_UNAVAILABLE'))).toBe(true);
    expect(requiresFreshQuote(new TypeError('Network request failed'))).toBe(false);
    expect(requiresFreshQuote(apiError('HTTP_500'))).toBe(false);
  });
});
