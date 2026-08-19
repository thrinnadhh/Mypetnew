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
    const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');

    expectAll(home, ['Food & Nutrition', 'Treats & Chews', 'Toys & Enrichment', 'Travel & Apparel']);
    expectAll(category, [
      "food: 'Food & Nutrition'", "toys: 'Toys & Enrichment'", "travel: 'Travel & Apparel'",
      "treats: 'Treats & Chews'", "apparel: 'Travel & Apparel'", "appearance: 'Travel & Apparel'", 'catalogQueryFor',
    ]);
    expectAll(categoryTemplate, ['fetchCommerceCatalogPage', 'CUSTOMER_CATALOG_PAGE_SIZE']);
  });

  it('prevents blank catalog, banner and shop images with resilient fallbacks', () => {
    const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
    const banners = source('src/components/ui/banner-carousel.tsx');
    const provider = source('src/components/commerce/ProviderProfileTemplate.tsx');
    const resilientImage = source('src/components/ui/resilient-remote-image.tsx');

    expectAll(categoryTemplate, ['ResilientRemoteImage', 'fallbackUri']);
    expectAll(banners, ['ResilientRemoteImage', 'uri={item.imageUrl}', 'fallbackUri={DEMO_MEDIA.store}']);
    expect(banners).not.toContain('DEMO_BANNER_IMAGES');
    expectAll(provider, ['ResilientRemoteImage', 'shop.heroImageUrl', 'item.imageUrl']);
    expectAll(resilientImage, ['onError', 'fallbackUri', 'appConfig.allowDemoMode', 'styles.placeholder']);
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
    expectAll(demoData, ['DEMO_MEDIA', 'DEMO_BANNER_IMAGES', 'DEMO_PROVIDER_FIXTURES', 'getDemoAppointmentSlots', 'demoShopImage']);
  });

  it('uses customer-owned holds, online-or-provider payment choice and provider-confirmed requests', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');
    const booking = source('src/services/appointment-booking.ts');
    const history = source('src/services/customer-history.ts');
    const appointmentList = source('src/screens/appointments-screen.tsx');
    const payments = source('src/services/customer-payments.ts');

    expectAll(discovery, [
      'fetchAvailableAppointmentSlots', 'fetchCustomerPets', 'holdAppointmentSlot', "pathname: '/appointments/payment'",
      "setPaymentMethod('ONLINE_PAYMENT')", "setPaymentMethod('PAY_AT_PROVIDER')", 'paymentMethod,',
    ]);
    expect(discovery).not.toContain('confirmAppointmentHold(');

    expectAll(booking, [
      '/api/v1/public/services', '/api/v1/customer/appointments', "'Idempotency-Key'",
      "export type AppointmentPaymentMethod = 'PAY_AT_PROVIDER' | 'ONLINE_PAYMENT'",
      "input.paymentMethod ?? 'PAY_AT_PROVIDER'", 'paymentMethod,', 'petId: input.petId', '/confirm',
    ]);
    expect(booking).not.toContain('/api/v1/catalog/offerings');
    expect(booking).not.toContain('/api/v1/appointments/hold');
    expect(booking).not.toContain('customerId: resolveBookingUserId');
    expect(booking).not.toContain('priceAmount: input.slot.price');
    expect(booking).not.toContain('payAtClinic');

    expectAll(payment, [
      'Provider confirmation required', 'PAYMENT FIRST · PROVIDER ACCEPTANCE NEXT', 'Pay online & send request',
      'Send booking request · Pay at provider', 'initiateAppointmentPayment(action.appointmentId, action.userId)',
      'openCashfreeOrder(payment)', 'waitForPaymentOutcome(payment.paymentId, 30, 2_000, action.userId)',
      'Payment successful · waiting for provider', 'refund workflow automatically',
      'confirmAppointmentHold(action.appointmentId, action.accessToken)',
      "appointment.status !== 'SLOT_HELD'", 'samePaymentContext(paymentContextRef.current, action)',
    ]);
    expect(payment).not.toContain('Appointment booked');

    expectAll(payments, [
      "referenceType: 'APPOINTMENT'", 'referenceId: appointmentId', "provider: 'CASHFREE'", 'fetchPaymentStatus', 'waitForPaymentOutcome',
    ]);
    const appointmentInitiation = payments.slice(
      payments.indexOf('export async function initiateAppointmentPayment'),
      payments.indexOf('export async function fetchPaymentStatus'),
    );
    const appointmentRequest = appointmentInitiation.slice(
      appointmentInitiation.indexOf("apiClient.post<CustomerPaymentView>"),
      appointmentInitiation.indexOf("{ 'Idempotency-Key': idempotencyKey }"),
    );
    expect(appointmentRequest).not.toContain('amountPaise');
    expect(appointmentRequest).not.toContain('currency:');
    expect(appointmentRequest).not.toContain('customerId:');
    expect(appointmentRequest).not.toContain('userId:');

    expect(history).toContain("case 'BOOKED': return 'PENDING_PROVIDER'");
    expect(history).toContain("case 'REJECTED': return 'REJECTED'");
    expect(appointmentList).toContain('WAITING FOR PROVIDER');
  });

  it('supports safe demo appointment requests without opening Cashfree', () => {
    const payment = source('src/app/appointments/payment.tsx');
    expectAll(payment, [
      "appointmentId.startsWith('demo-appointment-')", 'confirmAppointmentHold(action.appointmentId, action.accessToken)',
      'Development fixture only. No real provider or payment action is created.',
    ]);
    expect(payment).toContain("const online = paymentMethod === 'ONLINE_PAYMENT' && !demoAppointment");
  });

  it('uses one canonical Cashfree customer-payment API for products and appointments without client-authored money', () => {
    const client = source('src/services/customer-payments.ts');
    const contract = source('../../docs/architecture/P5_PAYMENT_CONTRACT.md');

    expectAll(client, [
      "'/api/v1/customer/payments'", "referenceType: 'PRODUCT_ORDER'", "referenceType: 'APPOINTMENT'", "provider: 'CASHFREE'",
      "'Idempotency-Key': idempotencyKey", 'fetchPaymentStatus', 'waitForPaymentOutcome',
    ]);
    expect(client).not.toContain('/api/v1/payments/appointments');
    expect(client).not.toContain('normalizedPhone');
    expectAll(contract, ['CASHFREE_API_VERSION', 'CASHFREE_WEBHOOK_VERSION', 'PRODUCT_ORDER', 'ONLINE_PAYMENT']);
  });

  it('keeps product checkout on one server-authoritative order contract for pickup and Captain delivery', () => {
    const checkout = source('src/app/checkout/index.tsx');
    const orderClient = source('src/services/customer-checkout.ts');
    const quoteClient = source('src/services/customer-quotes.ts');

    expectAll(checkout, [
      'Store pickup', 'Captain delivery', 'Pay on fulfilment', 'Online payment', 'fetchPickupQuote', 'fetchCaptainDeliveryQuote',
      'createProductOrder', 'initiateOrderPayment', 'openCashfreeOrder', 'waitForPaymentOutcome', 'Verifying payment…',
      "setFulfilmentMode('MYPET_CAPTAIN_DELIVERY')",
    ]);
    expectAll(orderClient, [
      "export type ProductFulfilmentMode = 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY'",
      "export type ProductPaymentMethod = 'PAY_ON_FULFILMENT' | 'ONLINE_PAYMENT'", "'/api/v1/customer/orders'",
      'quoteId: input.quoteId, cartSignature: input.cartSignature', "'Idempotency-Key': `checkout:${input.quoteId}`",
      'order.paymentMethod !== expectedPaymentMethod',
    ]);
    const checkoutPost = orderClient.slice(
      orderClient.indexOf("const order = await apiClient.post<ProductOrderDto>"),
      orderClient.indexOf('if (', orderClient.indexOf("const order = await apiClient.post<ProductOrderDto>")),
    );
    expect(checkoutPost).toContain('{ quoteId: input.quoteId, cartSignature: input.cartSignature }');
    expect(checkoutPost).not.toContain('paymentMethod');
    expectAll(quoteClient, ["'/api/v1/customer/quotes/pickup'", "'/api/v1/customer/quotes/delivery'", 'paymentMethod']);
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
    expectAll(checkout, ['const demoCheckout = appConfig.allowDemoMode', 'Demo pickup simulated', 'No backend order was created', 'fetchPickupQuote', 'createProductOrder']);
    expect(checkout.indexOf('if (demoCheckout)')).toBeLessThan(checkout.indexOf('const order = await createProductOrder'));
  });

  it('keeps customer identity and payment amount server-authoritative', () => {
    const auth = source('src/context/AuthContext.tsx');
    const profile = source('src/services/customer-profile.ts');
    const payments = source('src/services/customer-payments.ts');

    expectAll(auth, ['apiClient.setSessionToken(nextSession?.accessToken ?? null)', 'applySessionState(null)']);
    expectAll(profile, ['/api/v1/customer/profile', '/api/v1/customer/addresses', 'authHeaders(accessToken)']);
    expect(profile).not.toContain('/api/v1/addresses/default');
    expect(profile).not.toContain('customerId=');
    expectAll(payments, ["referenceType: 'PRODUCT_ORDER'", "referenceType: 'APPOINTMENT'", "provider: 'CASHFREE'"]);
    expect(payments).not.toContain('normalizedPhone');
    expect(payments).not.toContain('customerPhone');
    expect(payments).not.toContain('userId:');
    expect(payments).toContain('amountPaise: number;');
    expect(payments).toContain("currency: 'INR';");
  });

  it('verifies canonical recurring-order cadences and explicit confirmation safety per Decision D-019', () => {
    const subscriptions = source('src/app/subscriptions/index.tsx');
    const service = source('src/services/recurring-orders.ts');
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/recurring/domain/RecurringOrderService.kt');
    const decisions = source('../../docs/product/DECISIONS.md');

    expect(RECURRING_CADENCES).toEqual([7, 15, 25, 30, 35]);
    for (const cadence of RECURRING_CADENCES) expect(isRecurringCadence(cadence)).toBe(true);
    expect(isRecurringCadence(10)).toBe(false);
    expectAll(subscriptions, ['No silent order or charge', 'Revalidate and continue']);
    expect(service).toContain('/api/v1/customer/recurring-orders');
    expect(service).not.toContain('/api/v1/orders/subscriptions');
    expectAll(backend, ['RenewalProposalStatus.AWAITING_CONFIRMATION', 'ALLOWED_CADENCES = setOf(7, 15, 25, 30, 35)', 'sellingPricePaise']);
    expectAll(decisions, [
      'Recurring product orders support fixed cadences of 7, 15, 25, 30, and 35 days',
      'No automatic COD placement or payment mandate charge occurs',
    ]);
  });

  it('keeps appointment booking real while grooming entry remains provider-first', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const grooming = source('src/app/grooming/index.tsx');

    expect(discovery).not.toContain('setTimeout(');
    expect(discovery).not.toContain('mockAppointment');
    expectAll(discovery, ['fetchAvailableAppointmentSlots', 'holdAppointmentSlot']);

    expect(grooming).not.toContain('setTimeout(');
    expectAll(grooming, ["fetchProviderPage('GROOMER'", '/groomer/', 'Grooming near you']);
    expect(grooming).not.toContain('fetchAppointmentServices');
    expect(grooming).not.toContain('fetchAvailableAppointmentSlots');
    expect(grooming).not.toContain('Choose live slot & pay');
    expect(grooming).not.toContain('Pay at provider');
  });
});
