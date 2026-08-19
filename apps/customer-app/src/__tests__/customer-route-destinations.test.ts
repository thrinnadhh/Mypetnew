import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('customer route destination regressions', () => {
  it('keeps the appointment list destination reachable from home and booking confirmation', () => {
    const appointmentsRoute = 'src/app/appointments/index.tsx';
    const route = source(appointmentsRoute);
    const home = source('src/screens/home-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');

    expect(existsSync(join(process.cwd(), appointmentsRoute))).toBe(true);
    expect(route).toMatch(/screens\/appointments-screen/);
    expect(home).toContain('/appointments');
    expect(payment).toContain('/appointments?appointmentId=');
  });

  it('keeps successful product payment navigation backed by the order-detail route', () => {
    const orderDetailRoute = 'src/app/orders/[id].tsx';
    const checkout = source('src/app/checkout/index.tsx');

    expect(existsSync(join(process.cwd(), orderDetailRoute))).toBe(true);
    expect(checkout).toMatch(/router\.replace\(`\/orders\/\$\{orderId\}`/);
  });

  it('keeps grooming provider discovery canonical while preserving parameterized later-phase booking compatibility', () => {
    const groomRoute = source('src/app/groom.tsx');
    const groomingDiscovery = source('src/app/grooming/index.tsx');
    const providerDetail = source('src/screens/live-care-provider-detail-screen.tsx');

    expect(groomRoute).toContain('Redirect href="/grooming"');
    expect(groomRoute).toContain('AppointmentDiscoveryScreen');
    expect(groomRoute).toContain('providerId || serviceId');
    expect(groomingDiscovery).toContain("fetchProviderPage('GROOMER'");
    expect(groomingDiscovery).toContain('/groomer/');
    expect(groomingDiscovery).not.toContain('fetchAppointmentServices');
    expect(groomingDiscovery).not.toContain('fetchAvailableAppointmentSlots');
    expect(groomingDiscovery).not.toContain('Choose live slot');
    expect(groomingDiscovery).not.toContain('Pay at provider');
    expect(providerDetail).toContain("const bookingRoute = kind === 'groomer' ? '/groom' : '/vet'");
    expect(providerDetail).toContain('router.canGoBack()');
    expect(providerDetail).toContain('router.replace(bookingRoute');
    expect(providerDetail).toContain('onBack={goBack}');
  });

  it('keeps product details resilient, serviceable, navigable and variant-stock aware', () => {
    const productDetail = source('src/app/commerce/product-detail.tsx');
    const screenHeader = source('src/components/ui/screen-header.tsx');

    expect(productDetail).toContain('ResilientRemoteImage');
    expect(productDetail).toContain('variantOutOfStock');
    expect(productDetail).toContain('selectedVariant.id');
    expect(productDetail).toContain('fetchServiceableCommerceProduct(id, selectedPincode)');
    expect(productDetail).toContain('router.canGoBack()');
    expect(productDetail).toContain("router.replace('/products'");
    expect(productDetail).toContain('onBack={goBack}');
    expect(screenHeader).toContain('accessibilityLabel={backLabel}');
  });

  it('keeps the appointment booking hub connected and deterministic on direct entry', () => {
    const bookingHub = source('src/app/appointments/book.tsx');

    expect(bookingHub).toContain("router.push('/vet'");
    expect(bookingHub).toContain("router.push('/groom'");
    expect(bookingHub).toContain('router.canGoBack()');
    expect(bookingHub).toContain("router.replace('/appointments'");
    expect(bookingHub).toContain('onBack={handleBack}');
  });

  it('keeps appointment detail direct-entry exits safe and interactive controls at least 48dp', () => {
    const detail = source('src/app/appointments/[id].tsx');

    expect(detail).toContain('router.canGoBack()');
    expect(detail).toContain("router.replace('/appointments'");
    expect(detail).toContain('onAction={handleBack}');
    expect(detail).toContain('accessibilityLabel="Close appointment details"');
    expect(detail).toContain('backBtn: { minWidth: 48, minHeight: 48');
    expect(detail).toContain('actionBtn: { flex: 1, height: 48');
    expect(detail).toContain('docRow: { minHeight: 48');
  });
});
