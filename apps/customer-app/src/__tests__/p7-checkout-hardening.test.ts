import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P7 checkout transaction safety', () => {
  it('binds checkout to the selected service PIN, saved address and backend fulfilment eligibility', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expect(checkout).toContain('selectedPincode');
    expect(checkout).toContain("checkOutletServiceability(providerId, selectedPincode, 'PICKUP')");
    expect(checkout).toContain("checkOutletServiceability(providerId, selectedPincode, 'DELIVERY')");
    expect(checkout).toContain('selectedAddress.pincode === selectedPincode');
    expect(checkout).toContain('SERVICE PIN MISMATCH');
    expect(checkout).toContain('pickupAvailable ? (');
    expect(checkout).toContain('deliveryAvailable ? (');
  });

  it('prevents stale quote responses and state changes from reusing an old quote', () => {
    const checkout = source('src/app/checkout/index.tsx');
    const safety = source('src/services/checkout-safety.ts');

    expect(checkout).toContain('quoteGenerationRef');
    expect(checkout).toContain('requestGeneration !== quoteGenerationRef.current');
    expect(checkout).toContain('quote.requestKey === quoteRequestKey');
    expect(checkout).toContain('isQuoteExpired(quote.expiresAt)');
    expect(safety).toContain('input.selectedAddressId ??');
    expect(safety).toContain('input.selectedPincode');
    expect(safety).toContain('line.offeringId');
    expect(safety).toContain('line.quantity');
  });

  it('preserves the same quote after ambiguous order failures so retry remains idempotent', () => {
    const checkout = source('src/app/checkout/index.tsx');
    const safety = source('src/services/checkout-safety.ts');
    const orderClient = source('src/services/customer-checkout.ts');

    expect(checkout).toContain('if (requiresFreshQuote(error))');
    expect(checkout).toContain('Your current quote is preserved so a retry reuses the same idempotent order request.');
    expect(safety).toContain("'QUOTE_EXPIRED'");
    expect(safety).toContain("'QUOTE_STALE'");
    expect(safety).toContain("'QUOTE_NOT_FOUND'");
    expect(orderClient).toContain("'Idempotency-Key': `checkout:${input.quoteId}`");
    expect(checkout).not.toContain("Alert.alert('Checkout failed', message);\n      void loadQuote();");
  });

  it('distinguishes serviceability outages from an authoritative no-fulfilment result', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expect(checkout).toContain('availabilityError');
    expect(checkout).toContain('Retry fulfilment check');
    expect(checkout).toContain('setAvailabilityRetry((current) => current + 1)');
    expect(checkout).toContain('!availabilityError');
  });

  it('surfaces server price changes and quoted unit prices instead of stale cart pricing', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expect(checkout).toContain('PRICE UPDATED');
    expect(checkout).toContain('lineUnitPrices');
    expect(checkout).toContain('server price ₹');
    expect(checkout).toContain('Server-authoritative total');
  });
});
