import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function expectAll(content: string, values: string[]) {
  for (const value of values) expect(content).toContain(value);
}

describe('MyPet customer journey contracts', () => {
  it('keeps the home screen focused on real discovery instead of embedded demo checkout', () => {
    const home = source('src/screens/home-screen.tsx');
    expect(home).not.toContain('initiateOrderPayment');
    expect(home).not.toContain('openCashfreeOrder');
  });

  it('keeps product checkout on one server-authoritative order contract for pickup and Captain delivery', () => {
    const checkout = source('src/app/checkout/index.tsx');
    const orderClient = source('src/services/customer-checkout.ts');
    const deliveryClient = source('src/services/customer-delivery.ts');

    expectAll(checkout, [
      'Order items',
      'Server-authoritative total',
      'Store pickup',
      'Captain delivery',
      'Pay on fulfilment',
      'fetchCheckoutQuote',
      'fetchDeliveryQuote',
      'createProductOrder',
      "setFulfilmentMode('MYPET_CAPTAIN_DELIVERY')",
    ]);
    expect(checkout).not.toContain('initiateOrderPayment');
    expect(checkout).not.toContain('openCashfreeOrder');
    expect(checkout).not.toContain('waitForPaymentOutcome');
    expectAll(orderClient, [
      "export type ProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY'",
      "'/api/v1/customer/orders'",
      'quoteId: input.quoteId, cartSignature: input.cartSignature',
      "'Idempotency-Key': `checkout:${input.quoteId}`",
      'order.fulfilmentMode !== expectedFulfilmentMode',
      "order.paymentMethod !== 'PAY_ON_FULFILMENT'",
    ]);
    expectAll(deliveryClient, [
      "'/api/v1/customer/quotes/delivery'",
      'input: DeliveryQuoteInput',
      "{ Authorization: `Bearer ${accessToken}` }",
    ]);
    expect(deliveryClient).not.toContain('customerId: input');
  });

  it('keeps demo checkout non-chargeable while production remains server-authoritative', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expectAll(checkout, [
      'const demoCheckout = appConfig.allowDemoMode',
      'Demo pickup simulated',
      'No backend order was created',
      'fetchCheckoutQuote',
      'createProductOrder',
    ]);
    expect(checkout.indexOf('if (demoCheckout)')).toBeLessThan(checkout.indexOf('const order = await createProductOrder'));
  });

  it('preserves authenticated customer identity across profile and payment requests', () => {
    const auth = source('src/context/AuthContext.tsx');
    const profile = source('src/services/customer-profile.ts');
    const payments = source('src/services/customer-payments.ts');

    expect(auth).toContain('accessToken');
    expect(profile).toContain('/api/v1/customer/profile');
    expect(payments).not.toContain('userId:');
  });
});
