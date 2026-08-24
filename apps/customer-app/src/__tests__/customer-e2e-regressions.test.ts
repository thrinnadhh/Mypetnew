import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('customer end-to-end regression contracts', () => {
  it('uses bounded live catalog APIs instead of production demo fixtures', () => {
    const category = source('src/app/category/[id].tsx');
    const aliasRoute = source('src/app/commerce/[slug].tsx');
    const product = source('src/app/commerce/product-detail.tsx');
    const shop = source('src/app/shop/[id].tsx');
    const favourites = source('src/app/favourites/index.tsx');
    const discovery = source('src/screens/commerce-discovery-screen.tsx');
    const catalog = source('src/services/paginated-catalog.ts');
    const registry = source('src/services/route-catalog.ts');

    expect(category).toMatch(/catalogQueryFor/);
    expect(category).toMatch(/pincode: selectedPincode/);
    expect(aliasRoute).toMatch(/Redirect/);
    expect(aliasRoute).toMatch(/\/category\//);
    expect(product).toMatch(/fetchServiceableCommerceProduct/);
    expect(shop).toMatch(/fetchProductCatalogPage/);
    expect(shop).toMatch(/fetchServiceableProductStore/);
    expect(favourites).toMatch(/fetchServiceableCommerceProduct/);
    expect(favourites).toMatch(/fetchServiceableProductStore/);
    expect(favourites).toMatch(/selectedPincode/);
    expect(discovery).toMatch(/fetchPublicOutlets/);
    expect(discovery).toMatch(/pincode: selectedPincode/);
    expect(catalog).toMatch(/CUSTOMER_CATALOG_PAGE_SIZE = 20/);
    expect(`${category}\n${aliasRoute}\n${product}\n${shop}\n${favourites}\n${discovery}\n${registry}`).not.toMatch(/SAMPLE_PRODUCTS|SHOPS_DATA/);
    expect(discovery).not.toMatch(/fetchAllPublicOutlets/);
    expect(shop).not.toMatch(/fetchAllCatalogItems/);
  });

  it('propagates and clears authenticated server session while payment uses canonical apiClient', () => {
    const auth = source('src/context/AuthContext.tsx');
    const payments = source('src/services/customer-payments.ts');
    expect(auth).toMatch(/apiClient\.setSessionToken\(nextSession\?\.accessToken \?\? null\)/);
    expect(auth).toMatch(/applySessionState\(null\)/);
    expect(payments).toMatch(/apiClient\.post/);
    expect(payments).not.toMatch(/customerPhone|normalizedPhone|userId:/);
  });

  it('uses owned pets, payment-aware idempotent holds and provider-confirmed online or provider payment requests', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');
    const history = source('src/services/customer-history.ts');
    const list = source('src/screens/appointments-screen.tsx');
    const detail = source('src/app/appointments/[id].tsx');
    const service = source('src/services/appointment-booking.ts');
    const payments = source('src/services/customer-payments.ts');

    expect(discovery).toMatch(/fetchCustomerPets/);
    expect(discovery).toMatch(/createCustomerPet/);
    expect(discovery).toMatch(/holdAppointmentSlot/);
    expect(discovery).toMatch(/\/appointments\/payment/);
    expect(discovery).toMatch(/Pay online/);
    expect(discovery).toMatch(/Pay at provider/);
    expect(discovery).not.toMatch(/confirmAppointmentHold\(appointmentId/);

    expect(payment).toMatch(/Provider confirmation required/);
    expect(payment).toMatch(/Pay online & send request/);
    expect(payment).toMatch(/Send booking request · Pay at provider/);
    expect(payment).toMatch(/initiateAppointmentPayment\(action\.appointmentId, action\.userId\)/);
    expect(payment).toMatch(/openCashfreeOrder\(payment\)/);
    expect(payment).toMatch(/waitForPaymentOutcome\(payment\.paymentId, 30, 2_000, action\.userId\)/);
    expect(payment).toMatch(/Payment successful · waiting for provider/);
    expect(payment).toMatch(/refund workflow automatically/);
    expect(payment).toMatch(/confirmAppointmentHold\(action\.appointmentId, action\.accessToken\)/);
    expect(payment).not.toMatch(/Appointment booked/);

    expect(history).toMatch(/case 'BOOKED': return 'PENDING_PROVIDER'/);
    expect(history).toMatch(/case 'REJECTED': return 'REJECTED'/);
    expect(history).toMatch(/paymentMethod: appointment\.paymentMethod/);
    expect(history).toMatch(/paymentStatus: appointment\.paymentStatus/);
    expect(list).toMatch(/WAITING FOR PROVIDER/);
    expect(detail).toMatch(/Waiting for provider confirmation/);

    expect(service).toMatch(/\/api\/v1\/public\/services/);
    expect(service).toMatch(/\/api\/v1\/customer\/appointments/);
    expect(service).toMatch(/'Idempotency-Key'/);
    expect(service).toMatch(/input\.paymentMethod \?\? 'PAY_AT_PROVIDER'/);
    expect(service).toMatch(/petId: input\.petId/);
    expect(service).not.toMatch(/customerId: resolveBookingUserId|priceAmount: input\.slot\.price|payAtClinic/);
    expect(service).not.toMatch(/\/api\/v1\/catalog\/offerings|\/api\/v1\/appointments\/hold/);

    const appointmentPayment = payments.slice(
      payments.indexOf('export async function initiateAppointmentPayment'),
      payments.indexOf('export async function fetchPaymentStatus'),
    );
    const appointmentRequest = appointmentPayment.slice(
      appointmentPayment.indexOf('apiClient.post<CustomerPaymentView>'),
      appointmentPayment.indexOf("{ 'Idempotency-Key': idempotencyKey }"),
    );
    expect(appointmentRequest).toMatch(/referenceType: 'APPOINTMENT'/);
    expect(appointmentRequest).not.toMatch(/amountPaise|currency:|customerId:|userId:/);
    expect(appointmentPayment).toMatch(/Payment initiation returned a different appointment reference/);
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

  it('keeps product-card navigation separate from favourite and cart controls', () => {
    const category = source('src/components/commerce/CategoryTemplate.tsx');
    const provider = source('src/components/commerce/ProviderProfileTemplate.tsx');
    const favourites = source('src/app/favourites/index.tsx');

    expect(category).toContain('accessibilityLabel={`Open ${item.name} details`}');
    expect(category).toMatch(/<View\s+style=\{\[\s*styles\.productCard/);
    expect(provider).toContain('accessibilityLabel={`Open ${item.name} details`}');
    expect(provider).toMatch(/<View\s+key=\{item\.id\}/);
    expect(favourites).toContain('accessibilityLabel={`Open ${shop.name} details`}');
    expect(favourites).toContain('accessibilityLabel={`Open ${product.name} details`}');
    expect(favourites).toMatch(/<View\s+key=\{product\.id\}/);
  });

  it('keeps bottom-sheet content outside the dismiss backdrop button', () => {
    const primitives = source('src/components/foundation/primitives.tsx');

    expect(primitives).toContain('<View style={styles.overlay}>');
    expect(primitives).toContain('style={styles.backdrop}');
    expect(primitives).toContain('<View style={[styles.sheet, shadows.raised');
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

  it('keeps loyalty merchant-scoped and uses the canonical reward read projection without legacy global wallet actions', () => {
    const wallet = source('src/app/wallet/index.tsx');
    const loyaltyCard = source('src/components/loyalty-card.tsx');
    const loyalty = source('src/services/loyalty.ts');
    const search = source('src/screens/search-screen.tsx');
    expect(loyaltyCard).toMatch(/fetchCustomerLoyaltyBalance/);
    expect(loyaltyCard).toMatch(/fetchPublicOutlet/);
    expect(loyaltyCard).toMatch(/Available rewards/);
    expect(loyaltyCard).toMatch(/valuePaise/);
    expect(loyaltyCard).not.toMatch(/claimWelcomeStar|fetchLoyaltyProgress/);
    expect(wallet).toMatch(/Loyalty belongs to each merchant/);
    expect(wallet).not.toMatch(/fetchCustomerWallet|fetchActivePromotions|SAVE50/);
    expect(loyalty).toMatch(/\/api\/v2\/customer\/loyalty\//);
    expect(loyalty).toMatch(/rewards: CustomerLoyaltyRewardResponse\[\]/);
    expect(search).not.toMatch(/Puppy Nutrition/);
    expect(search).not.toMatch(/Simulate voice|Listening\.\.\. Speak now/);
  });

  it('persists address, exact service PIN and unavailable-city intent through backend APIs', () => {
    const profile = source('src/services/customer-profile.ts');
    const location = source('src/context/LocationContext.tsx');
    expect(profile).toMatch(/\/api\/v1\/customer\/addresses/);
    expect(profile).toMatch(/apiClient\.(post|patch)/);
    expect(profile).not.toMatch(/\/api\/v1\/addresses\/default/);
    expect(location).toMatch(/\/api\/v1\/service-regions\/launch-requests/);
    expect(location).toMatch(/PIN_STORAGE_KEY/);
    expect(location).toMatch(/selectedPincode/);
    expect(location).toMatch(/apiClient\.post/);
    expect(location).not.toMatch(/\bfetch\s*\(/);
  });

  it('uses foreground device coordinates to select a service city and service PIN', () => {
    const context = source('src/context/LocationContext.tsx');
    const modal = source('src/components/location-modal.tsx');
    const locationService = source('src/services/device-location.ts');
    const config = source('app.json');
    expect(context).toMatch(/requestCurrentCoordinates/);
    expect(context).toMatch(/nearestEnabledCity/);
    expect(context).toMatch(/normalizeSelectablePincode/);
    expect(modal).toMatch(/Use current location/);
    expect(modal).toMatch(/Select Service Location/);
    expect(locationService).toMatch(/requestForegroundPermissionsAsync/);
    expect(locationService).toMatch(/getCurrentPositionAsync/);
    expect(config).toMatch(/expo-location/);
  });

  it('does not expose cached orders after authorization or server failures', () => {
    const orders = source('src/services/customer-orders.ts');
    expect(orders).toMatch(/if \(!isOfflineFailure\(error\)\) throw error/);
    expect(orders).toMatch(/error instanceof ApiError/);
    expect(orders).toMatch(/error\.status === 0/);
  });

  it('uses the canonical authenticated API client for favourites and push registration', () => {
    const favourites = source('src/context/FavouritesContext.tsx');
    const notifications = source('src/hooks/usePushNotifications.ts');
    expect(favourites).toMatch(/apiClient\.get/);
    expect(favourites).toMatch(/apiClient\.put/);
    expect(favourites).toMatch(/apiClient\.delete/);
    expect(favourites).toMatch(/apiClient\.getAuthEpoch/);
    expect(notifications).toMatch(/apiClient\.(post|delete)/);
    expect(notifications).not.toMatch(/\bfetch\s*\(/);
    expect(notifications).not.toContain('/api/v1/notifications/push-tokens');
    expect(notifications).not.toContain('getExpoPushTokenAsync');
    expect(notifications).toContain('/api/v1/devices/registrations');
    expect(notifications).toContain('getDevicePushTokenAsync');
  });
});
