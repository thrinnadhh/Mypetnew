import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('customer end-to-end regression contracts', () => {
  it('uses live catalog APIs instead of production demo fixtures', () => {
    const category = source('src/app/category/[id].tsx');
    const aliasRoute = source('src/app/commerce/[slug].tsx');
    const product = source('src/app/commerce/product-detail.tsx');
    const shop = source('src/app/shop/[id].tsx');
    const favourites = source('src/app/favourites/index.tsx');
    const discovery = source('src/screens/commerce-discovery-screen.tsx');
    const registry = source('src/services/route-catalog.ts');

    expect(category).toMatch(/fetchCommerceProducts/);
    expect(aliasRoute).toMatch(/fetchCommerceProducts/);
    expect(product).toMatch(/fetchCommerceProduct/);
    expect(shop).toMatch(/fetchShopProfile/);
    expect(favourites).toMatch(/fetchCommerceProduct/);
    expect(favourites).toMatch(/fetchShopProfile/);
    expect(discovery).toMatch(/fetchAllPublicOutlets/);
    expect(`${category}\n${aliasRoute}\n${product}\n${shop}\n${favourites}\n${discovery}\n${registry}`).not.toMatch(
      /SAMPLE_PRODUCTS|SHOPS_DATA/,
    );
  });

  it('propagates and clears authenticated server session while payment uses canonical apiClient', () => {
    const auth = source('src/context/AuthContext.tsx');
    const payments = source('src/services/customer-payments.ts');

    expect(auth).toMatch(/apiClient\.setSessionToken\(nextSession\?\.accessToken \?\? null\)/);
    expect(auth).toMatch(/applySessionState\(null\)/);
    expect(payments).toMatch(/apiClient\.post/);
    expect(payments).not.toMatch(/customerPhone|normalizedPhone|userId:/);
  });

  it('keeps appointment online payment fail-closed until Plan 8 while preserving owned-pet slot holds', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');
    const service = source('src/services/appointment-booking.ts');
    const payments = source('src/services/customer-payments.ts');

    expect(discovery).toMatch(/fetchCustomerPets/);
    expect(discovery).toMatch(/createCustomerPet/);
    expect(discovery).toMatch(/holdAppointmentSlot/);
    expect(discovery).toMatch(/\/appointments\/payment/);
    expect(discovery).not.toMatch(/confirmAppointmentHold\(appointmentId/);
    expect(payment).toMatch(/Online appointment payment is not available yet/);
    expect(payment).toMatch(/Plan 5 online payment is limited to product orders/);
    expect(payment).not.toMatch(/initiateAppointmentPayment|openCashfreeOrder|waitForReferencePaymentOutcome/);
    expect(payments).toMatch(/Appointment online payment is not available until Plan 8/);
    expect(payments).not.toMatch(/APPOINTMENT_PAYMENT/);
    expect(service).toMatch(/petId: input\.petId/);
    expect(service).toMatch(/payAtClinic: false/);
    expect(service).not.toMatch(/petId: bookingUserId/);
  });

  it('does not retain the obsolete mock appointment modal or timer hook', () => {
    expect(existsSync(join(process.cwd(), 'src/hooks/useAppointmentBooking.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'src/components/care/AppointmentBookingModal.tsx'))).toBe(false);
  });

  it('uses live banner media and target-aware internal navigation', () => {
    const content = source('src/services/content.ts');
    const banner = source('src/components/ui/banner-carousel.tsx');
    const contract = source('src/constants/content.ts');

    expect(contract).toMatch(/BannerTargetType/);
    expect(contract).toMatch(/PRODUCT.*STORE.*CATEGORY.*ROUTE/s);
    expect(content).toMatch(/\/api\/v1\/content\/banners/);
    expect(banner).toMatch(/item\.imageUrl/);
    expect(banner).toMatch(/commerce\/product-detail/);
    expect(banner).toMatch(/\/shop\//);
    expect(banner).toMatch(/\/category\//);
    expect(banner).toMatch(/!target\.includes\(':\/\/'\)/);
  });

  it('isolates carts by customer, rebuilds subscription carts, and keeps order detail server-authoritative', () => {
    const cart = source('src/context/CartContext.tsx');
    const order = source('src/app/orders/[id].tsx');
    const subscriptions = source('src/app/subscriptions/index.tsx');

    expect(cart).toMatch(/customer_\$\{userId\}/);
    expect(cart).toMatch(/replaceCart/);
    expect(order).toMatch(/fetchCustomerOrderDetail/);
    expect(order).toMatch(/cancelCustomerOrder/);
    expect(order).not.toMatch(/buildCartFromRevalidation|replaceCart/);
    expect(subscriptions).toMatch(/buildCartFromRevalidation/);
    expect(subscriptions).toMatch(/replaceCart/);
  });

  it('keeps Sprint-1 loyalty merchant-scoped and does not expose legacy global wallet actions', () => {
    const wallet = source('src/app/wallet/index.tsx');
    const loyaltyCard = source('src/components/loyalty-card.tsx');
    const loyalty = source('src/services/loyalty.ts');
    const search = source('src/screens/search-screen.tsx');

    expect(loyaltyCard).toMatch(/fetchCustomerLoyaltyBalance/);
    expect(loyaltyCard).toMatch(/fetchPublicOutlet/);
    expect(loyaltyCard).not.toMatch(/claimWelcomeStar|fetchLoyaltyProgress/);
    expect(wallet).toMatch(/Loyalty belongs to each merchant/);
    expect(wallet).not.toMatch(/fetchCustomerWallet|fetchActivePromotions|SAVE50/);
    expect(loyalty).toMatch(/\/api\/v1\/customer\/loyalty\//);
    expect(search).not.toMatch(/Puppy Nutrition/);
    expect(search).not.toMatch(/Simulate voice|Listening\.\.\. Speak now/);
  });

  it('persists address and unavailable-city intent through backend APIs', () => {
    const profile = source('src/services/customer-profile.ts');
    const location = source('src/context/LocationContext.tsx');

    expect(profile).toMatch(/\/api\/v1\/customer\/addresses/);
    expect(profile).toMatch(/apiClient\.(post|patch)/);
    expect(profile).not.toMatch(/\/api\/v1\/addresses\/default/);
    expect(location).toMatch(/\/api\/v1\/service-regions\/launch-requests/);
    expect(location).toMatch(/method: 'POST'/);
  });

  it('uses foreground device coordinates to select a service city', () => {
    const context = source('src/context/LocationContext.tsx');
    const modal = source('src/components/location-modal.tsx');
    const locationService = source('src/services/device-location.ts');
    const config = source('app.json');

    expect(context).toMatch(/requestCurrentCoordinates/);
    expect(context).toMatch(/nearestEnabledCity/);
    expect(modal).toMatch(/Use current location/);
    expect(locationService).toMatch(/requestForegroundPermissionsAsync/);
    expect(locationService).toMatch(/getCurrentPositionAsync/);
    expect(config).toMatch(/expo-location/);
  });

  it('does not expose cached orders after authorization or server failures', () => {
    const orders = source('src/services/customer-orders.ts');

    expect(orders).toMatch(/if \(!isOfflineFailure\(error\)\) throw error/);
    expect(orders).toMatch(/error instanceof OrderHttpError/);
  });

  it('checks server responses for favourites and push registration', () => {
    const favourites = source('src/context/FavouritesContext.tsx');
    const notifications = source('src/hooks/usePushNotifications.ts');

    expect(favourites).toMatch(/if \(!response\.ok\) throw await serverError/);
    expect(notifications).toMatch(/if \(!response\.ok\) throw await responseError/);
    expect(notifications).not.toContain('/api/v1/notifications/push-tokens');
    expect(notifications).not.toContain('getExpoPushTokenAsync');
    expect(notifications).toContain('/api/v1/devices/registrations');
    expect(notifications).toContain('getDevicePushTokenAsync');
  });
});
