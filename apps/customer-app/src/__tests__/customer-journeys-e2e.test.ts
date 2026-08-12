import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RECURRING_CADENCES, isRecurringCadence } from '../contracts/recurring-orders';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function expectAll(content: string, values: string[]) {
  for (const value of values) expect(content).toContain(value);
}

describe('MyPet customer end-to-end journeys', () => {
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
    const checkout = source('src/app/checkout/index.tsx');
    const resilientImage = source('src/components/ui/resilient-remote-image.tsx');

    expectAll(categoryTemplate, ['ResilientRemoteImage', 'fallbackUri']);
    expectAll(banners, ['ResilientRemoteImage', 'DEMO_BANNER_IMAGES', 'fallbackUri={DEMO_MEDIA.store}']);
    expectAll(provider, ['ResilientRemoteImage', 'shop.heroImageUrl', 'item.imageUrl']);
    expectAll(checkout, ['ResilientRemoteImage', 'categoryImage(item.product.category)']);
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

  it('routes vet and grooming bookings through hold -> payment -> confirmation', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');
    const booking = source('src/services/appointment-booking.ts');

    expectAll(discovery, [
      'fetchAvailableAppointmentSlots',
      'fetchCustomerPets',
      'holdAppointmentSlot',
      "pathname: '/appointments/payment'",
      'Tap to review & pay',
    ]);
    expect(discovery).not.toContain('confirmAppointmentHold(');
    expectAll(booking, ['payAtClinic: false', 'petId: input.petId']);

    expectAll(payment, [
      'initiateAppointmentPayment',
      'openCashfreeOrder',
      'waitForReferencePaymentOutcome',
      'confirmAppointmentHold',
      "payment.status === 'SUCCESS'",
      'Payment breakdown',
      'Total payable',
      'The appointment is confirmed only after server-side payment verification.',
    ]);
  });

  it('supports safe demo appointment payment without changing live payment truth', () => {
    const payment = source('src/app/appointments/payment.tsx');

    expectAll(payment, [
      "appointmentId.startsWith('demo-appointment-')",
      "await finishAppointment('demo-payment')",
      'No real money will be charged.',
    ]);
    expect(payment.indexOf('if (demoPayment)')).toBeLessThan(
      payment.indexOf('const initialization = await initiateAppointmentPayment'),
    );
  });

  it('connects appointment payments to an authenticated server-owned Cashfree endpoint', () => {
    const client = source('src/services/customer-payments.ts');
    const controller = source('../../backend/payment-service/src/main/kotlin/com/pawsnearme/paymentservice/controller/PaymentController.kt');
    const gateway = source('../../backend/payment-service/src/main/kotlin/com/pawsnearme/paymentservice/service/CashfreeGatewayService.kt');

    expectAll(client, [
      "'/api/v1/payments/appointments'",
      "'APPOINTMENT_PAYMENT'",
      'waitForReferencePaymentOutcome',
    ]);
    expectAll(controller, [
      '@PostMapping("/appointments")',
      'APPOINTMENT_PAYMENT',
      'Access denied for appointment payment initiation',
    ]);
    expectAll(gateway, [
      'APPOINTMENT_PAYMENT',
      'SLOT_HELD',
      'customerId',
    ]);
  });

  it('shows a complete product checkout breakdown before COD or online payment', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expectAll(checkout, [
      'Order items',
      'Item subtotal',
      'Product savings',
      'Coupon discount',
      'Loyalty discount',
      'Delivery fee',
      'Tax',
      'Payable total',
      'Cash on delivery',
      'UPI',
      'Card',
      'fetchCheckoutQuote',
      'createCustomerOrder',
      'initiateOrderPayment',
      'openCashfreeOrder',
      'waitForPaymentOutcome',
    ]);
  });

  it('keeps demo checkout non-chargeable while production remains server-authoritative', () => {
    const checkout = source('src/app/checkout/index.tsx');

    expectAll(checkout, [
      'const demoCheckout = appConfig.allowDemoMode',
      'demoCheckoutQuote',
      'DEMO_ADDRESS',
      'No backend order was created and no money was charged.',
    ]);
    expect(checkout.indexOf('if (demoCheckout)')).toBeLessThan(checkout.indexOf('const order = await createOrder()'));
    expect(checkout).toContain('fetchCheckoutQuote');
  });

  it('preserves authenticated customer identity across profile and payment requests', () => {
    const auth = source('src/context/AuthContext.tsx');
    const profile = source('src/services/customer-profile.ts');
    const payments = source('src/services/customer-payments.ts');

    expectAll(auth, [
      'apiClient.setSessionToken(nextSession?.access_token ?? null)',
      'apiClient.setSessionToken(null)',
    ]);
    expectAll(profile, [
      '/api/v1/addresses/default',
      "method: 'PUT'",
      'Authorization: `Bearer ${accessToken}`',
    ]);
    expect(payments).toContain('normalizedPhone');
  });

  it('keeps recurring-order cadence and confirmation safety intact', () => {
    const subscriptions = source('src/app/subscriptions/index.tsx');
    const service = source('src/services/recurring-orders.ts');
    const backend = source('../../backend/order-service/src/main/kotlin/com/pawsnearme/orderservice/service/RecurringOrderService.kt');

    expect(RECURRING_CADENCES).toEqual([7, 15, 25, 30, 35]);
    for (const cadence of RECURRING_CADENCES) expect(isRecurringCadence(cadence)).toBe(true);
    expect(isRecurringCadence(10)).toBe(false);

    expectAll(subscriptions, ['No silent charging', 'Revalidate and confirm']);
    expect(service).toContain('/api/v1/orders/subscriptions');
    expectAll(backend, ['RecurringOrderConfirmationRequired', 'automaticCharge" to false', 'revalidateReorder']);
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
