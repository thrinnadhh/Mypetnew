import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RECURRING_CADENCES, isRecurringCadence } from '../contracts/recurring-orders';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function expectAll(content: string, values: string[]) {
  for (const value of values) expect(content).toContain(value);
}

describe('MyPet customer journey contracts', () => {
  it('connects home discovery to the requested commerce and care categories', () => {
    const home = source('src/screens/home-screen.tsx');
    const category = source('src/app/category/[id].tsx');

    expectAll(home, [
      'Food & Nutrition',
      'Treats & Chews',
      'Toys & Enrichment',
      'Travel & Apparel',
    ]);
    expectAll(category, [
      "food: 'Food & Nutrition'",
      "toys: 'Toys & Enrichment'",
      "travel: 'Travel & Apparel'",
      "treats: 'Treats & Chews'",
      "apparel: 'Travel & Apparel'",
      "appearance: 'Travel & Apparel'",
      'fetchCommerceProducts',
    ]);
  });

  it('prevents blank catalog, banner and shop images with resilient fallbacks', () => {
    const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
    const banners = source('src/components/ui/banner-carousel.tsx');
    const provider = source('src/components/commerce/ProviderProfileTemplate.tsx');
    const resilientImage = source('src/components/ui/resilient-remote-image.tsx');

    expectAll(categoryTemplate, ['ResilientRemoteImage', 'fallbackUri']);
    expectAll(banners, ['ResilientRemoteImage', 'DEMO_BANNER_IMAGES', 'fallbackUri={DEMO_MEDIA.store}']);
    expectAll(provider, ['ResilientRemoteImage', 'shop.heroImageUrl', 'item.imageUrl']);
    expectAll(resilientImage, ['onError', 'fallbackUri']);
  });

  it('keeps dummy marketplace data explicit and development-only', () => {
    const config = source('src/utils/app-config.ts');
    const catalog = source('src/services/customer-catalog.ts');
    const providers = source('src/services/provider-discovery.ts');
    const pets = source('src/services/customer-pets.ts');
    const demoData = source('src/services/demo-customer-data.ts');

    expect(config).toContain('allowDemoMode');
    expectAll(catalog, ['allowDemoMode', 'SAMPLE_PRODUCTS', 'DEMO_PROVIDER_FIXTURES']);
    expectAll(providers, ['allowDemoMode', 'DEMO_PROVIDER_FIXTURES']);
    expectAll(pets, ['allowDemoMode', 'demoPets']);
    expectAll(demoData, [
      'DEMO_MEDIA',
      'DEMO_BANNER_IMAGES',
      'DEMO_PROVIDER_FIXTURES',
      'getDemoAppointmentSlots',
      'demoShopImage',
    ]);
  });

  it('uses canonical customer-owned holds and provider-confirmed Pay at Provider requests', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');
    const booking = source('src/services/appointment-booking.ts');
    const history = source('src/services/customer-history.ts');
    const appointmentList = source('src/screens/appointments-screen.tsx');

    expectAll(discovery, [
      'fetchAvailableAppointmentSlots',
      'fetchCustomerPets',
      'holdAppointmentSlot',
      "pathname: '/appointments/payment'",
      'serviceId?: string',
    ]);
    expect(discovery).not.toContain('confirmAppointmentHold(');

    expectAll(booking, [
      '/api/v1/public/services',
      '/api/v1/customer/appointments',
      "'Idempotency-Key'",
      "paymentMethod: 'PAY_AT_PROVIDER'",
      'petId: input.petId',
      '/confirm',
    ]);
    expect(booking).not.toContain('/api/v1/catalog/offerings');
    expect(booking).not.toContain('/api/v1/appointments/hold');
    expect(booking).not.toContain('customerId: resolveBookingUserId');
    expect(booking).not.toContain('priceAmount: input.slot.price');
    expect(booking).not.toContain('payAtClinic');

    expectAll(payment, [
      'WAITING FOR PROVIDER ACCEPTANCE',
      'Provider confirmation required',
      'No online payment is created for this booking request.',
      'confirmAppointmentHold(appointmentId, session.accessToken)',
      'Send booking request · Pay at provider',
      'Booking request sent',
    ]);
    expect(payment).not.toContain('Appointment booked');
    expect(payment).not.toContain('initiateAppointmentPayment');
    expect(payment).not.toContain('openCashfreeOrder');
    expect(payment).not.toContain('waitForReferencePaymentOutcome');

    expect(history).toContain("case 'BOOKED': return 'PENDING_PROVIDER'");
    expect(history).toContain("case 'REJECTED': return 'REJECTED'");
    expect(appointmentList).toContain('WAITING FOR PROVIDER');
  });

  it('supports safe demo appointment requests without creating a real payment', () => {
    const payment = source('src/app/appointments/payment.tsx');

    expectAll(payment, [
      "appointmentId.startsWith('demo-appointment-')",
      'confirmAppointmentHold(appointmentId, session.accessToken)',
      'Development fixture only. No real provider or payment action is created.',
    ]);
    expect(payment).not.toContain('openCashfreeOrder');
  });

  it('uses the canonical Plan 5 Cashfree product-payment contract without coupling it to appointments', () => {
    const client = source('src/services/customer-payments.ts');
    const contract = source('../../docs/architecture/P5_PAYMENT_CONTRACT.md');

    expectAll(client, [
      "'/api/v1/customer/payments'",
      "referenceType: 'PRODUCT_ORDER'",
      "provider: 'CASHFREE'",
      "'Idempotency-Key': idempotencyKey",
      'fetchPaymentStatus',
      'waitForPaymentOutcome',
    ]);
    expect(client).not.toContain('/api/v1/payments/appointments');
    expect(client).not.toContain('APPOINTMENT_PAYMENT');
    expect(client).not.toContain('normalizedPhone');
    expectAll(contract, [
      'CASHFREE_API_VERSION',
      'CASHFREE_WEBHOOK_VERSION',
      'PRODUCT_ORDER',
      'ONLINE_PAYMENT',
    ]);
  });

  it('keeps product checkout on one server-authoritative order contract for pickup and Captain delivery', () => {
    const checkout = source('src/app/checkout/index.tsx');
    const orderClient = source('src/services/customer-checkout.ts');
    const quoteClient = source('src/services/customer-quotes.ts');

    expectAll(checkout, [
      'Store pickup',
      'Captain delivery',
      'Pay on fulfilment',
      'Online payment',
      'fetchPickupQuote',
      'fetchCaptainDeliveryQuote',
      'createProductOrder',
      'initiateOrderPayment',
      'openCashfreeOrder',
      'waitForPaymentOutcome',
      'Verifying payment…',
      "setFulfilmentMode('MYPET_CAPTAIN_DELIVERY')",
    ]);
    expectAll(orderClient, [
      "export type ProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY'",
      "export type ProductPaymentMethod = 'PAY_ON_FULFILMENT' | 'ONLINE_PAYMENT'",
      "'/api/v1/customer/orders'",
      'quoteId: input.quoteId, cartSignature: input.cartSignature',
      "'Idempotency-Key': `checkout:${input.quoteId}`",
      'order.paymentMethod !== expectedPaymentMethod',
    ]);
    const checkoutPost = orderClient.slice(
      orderClient.indexOf("const order = await apiClient.post<ProductOrderDto>"),
      orderClient.indexOf('if (', orderClient.indexOf("const order = await apiClient.post<ProductOrderDto>")),
    );
    expect(checkoutPost).toContain('{ quoteId: input.quoteId, cartSignature: input.cartSignature }');
    expect(checkoutPost).not.toContain('paymentMethod');
    expectAll(quoteClient, [
      "'/api/v1/customer/quotes/pickup'",
      "'/api/v1/customer/quotes/delivery'",
      'paymentMethod',
    ]);
    const pickupQuoteRequest = quoteClient.slice(
      quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/pickup'"),
      quoteClient.indexOf("'STORE_PICKUP'", quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/pickup'")),
    );
    const deliveryQuoteRequest = quoteClient.slice(
      quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/delivery'"),
      quoteClient.indexOf("'MYPET_CAPTAIN_DELIVERY'", quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/delivery'")),
    );
    expect(pickupQuoteRequest).not.toContain('customerId');
    expect(deliveryQuoteRequest).not.toContain('customerId');
    expect(quoteClient).toContain('customerId: string;');
  });

  it('keeps demo checkout non-chargeable while production remains server-authoritative', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expectAll(checkout, [
      'const demoCheckout = appConfig.allowDemoMode',
      'Demo pickup simulated',
      'No backend order was created',
      'fetchPickupQuote',
      'createProductOrder',
    ]);
    expect(checkout.indexOf('if (demoCheckout)')).toBeLessThan(checkout.indexOf('const order = await createProductOrder'));
  });

  it('keeps customer identity and payment amount server-authoritative', () => {
    const auth = source('src/context/AuthContext.tsx');
    const profile = source('src/services/customer-profile.ts');
    const payments = source('src/services/customer-payments.ts');

    expectAll(auth, [
      'apiClient.setSessionToken(nextSession?.accessToken ?? null)',
      'applySessionState(null)',
    ]);
    expectAll(profile, [
      '/api/v1/customer/profile',
      '/api/v1/customer/addresses',
      'authHeaders(accessToken)',
    ]);
    expect(profile).not.toContain('/api/v1/addresses/default');
    expect(profile).not.toContain('customerId=');
    expectAll(payments, [
      "referenceType: 'PRODUCT_ORDER'",
      'referenceId: orderId',
      "provider: 'CASHFREE'",
    ]);
    const initiation = payments.slice(
      payments.indexOf('const payment = await apiClient.post<CustomerPaymentView>'),
      payments.indexOf('await rememberPendingPayment', payments.indexOf('const payment = await apiClient.post<CustomerPaymentView>')),
    );
    expect(initiation).not.toContain('normalizedPhone');
    expect(initiation).not.toContain('customerPhone');
    expect(initiation).not.toContain('userId');
    expect(initiation).not.toContain('amountPaise');
    expect(initiation).not.toContain('currency:');
    expect(payments).toContain('amountPaise: number;');
    expect(payments).toContain("currency: 'INR';");
  });

  it('verifies recurring-order cadences (7/15/25/30/35) and confirmation safety per Decision D-019 while backend runtime is deferred', () => {
    const subscriptions = source('src/app/subscriptions/index.tsx');
    const service = source('src/services/recurring-orders.ts');
    const decisions = source('../../docs/product/DECISIONS.md');
    const matrix = source('../../docs/architecture/CUSTOMER_API_COMPATIBILITY_MATRIX.md');

    expect(RECURRING_CADENCES).toEqual([7, 15, 25, 30, 35]);
    for (const cadence of RECURRING_CADENCES) expect(isRecurringCadence(cadence)).toBe(true);
    expect(isRecurringCadence(10)).toBe(false);

    expectAll(subscriptions, ['No silent charging', 'Revalidate and confirm']);
    expect(service).toContain('/api/v1/orders/subscriptions');
    expectAll(decisions, [
      'Recurring product orders support fixed cadences of 7, 15, 25, 30, and 35 days',
      'No automatic COD placement or payment mandate charge occurs',
    ]);
    expect(matrix).toContain('- **2.6.2 Recurring Orders & Subscriptions (`DEFERRED`)**:');
  });

  it('keeps the core customer journeys free of mock appointment confirmation timers', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const grooming = source('src/app/grooming/index.tsx');

    expect(discovery).not.toContain('setTimeout(');
    expect(discovery).not.toContain('mockAppointment');
    expect(grooming).not.toContain('setTimeout(');
    expectAll(grooming, ['/groom', 'Choose live slot & pay']);
  });
});
