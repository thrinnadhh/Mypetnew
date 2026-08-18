import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P6 search, favourites and provider discovery contract', () => {
  it('preserves P4 product search pagination, service PIN scope, stale protection and truthful suggestions', () => {
    const search = source('src/screens/search-screen.tsx');

    expect(search).toContain('fetchProductCatalogPage');
    expect(search).toContain('CUSTOMER_CATALOG_PAGE_SIZE');
    expect(search).toContain('pincode: selectedPincode');
    expect(search).toContain('requestGeneration');
    expect(search).toContain('loadingMoreRef');
    expect(search).toContain('Retry loading more');
    expect(search).toContain('router.setParams({ q: clean })');
    expect(search).toContain('/commerce/product-detail?id=');
    expect(search).toContain('Suggested Searches');
    expect(search).not.toContain('Popular Searches');
  });

  it('uses an exact live service PIN and bounded page contract for provider discovery', () => {
    const service = source('src/services/provider-discovery.ts');
    const discovery = source('src/screens/appointment-discovery-screen.tsx');

    expect(service).toContain('PROVIDER_DISCOVERY_PAGE_SIZE = 20');
    expect(service).toContain('requireValidServicePincode');
    expect(service).toContain("GROOMER: ['GROOMING']");
    expect(service).toContain("PET_STORE: ['PRODUCT_STORE']");
    expect(service).toContain("VET_HOSPITAL: ['VETERINARY_CLINIC', 'VETERINARY_HOSPITAL']");
    expect(service).toContain("if (normalizedQuery) query.set('q', normalizedQuery)");
    expect(service).toContain('mergeUniqueOutlets');
    expect(service).toContain('sourcePageSize');
    expect(service).not.toContain('distanceKm: 0');
    expect(service).not.toContain('rating: 0');
    expect(service).not.toContain('ratingCount: 0');

    expect(discovery).toContain('selectedPincode');
    expect(discovery).toContain('fetchProviderPage');
    expect(discovery).toContain('providerRequestGeneration');
    expect(discovery).toContain('loadingMoreRef');
    expect(discovery).toContain('Load more providers');
    expect(discovery).toContain('Retry loading more');
    expect(discovery).not.toContain('activeCity.pincodes');
  });

  it('validates direct provider handoffs even when the target is beyond page zero', () => {
    const discovery = source('src/screens/appointment-discovery-screen.tsx');

    expect(discovery).toContain('preferredProviderId && !firstPageItems.some');
    expect(discovery).toContain('fetchProviderProfile(preferredProviderId');
    expect(discovery).toContain('kind: providerKind');
    expect(discovery).toContain('pincode: selectedPincode');
    expect(discovery).toContain("throw new Error('PROVIDER_IDENTITY_UNAVAILABLE')");
    expect(discovery).toContain('mergeUniqueProviders(firstPageItems');
  });

  it('fails provider deep links closed on PIN, activity and capability mismatches', () => {
    const profileService = source('src/services/provider-profile.ts');
    const careDetail = source('src/screens/live-care-provider-detail-screen.tsx');
    const genericDetail = source('src/screens/provider-profile-screen.tsx');

    expect(profileService).toContain('requireValidServicePincode');
    expect(profileService).toContain("case 'store': return ['PRODUCT_STORE']");
    expect(profileService).toContain("case 'groomer': return ['GROOMING']");
    expect(profileService).toContain("case 'vet': return ['VETERINARY_CLINIC', 'VETERINARY_HOSPITAL']");
    expect(profileService).toContain("throw new Error('PROVIDER_CAPABILITY_MISMATCH')");
    expect(profileService).toContain('fetchPublicOutlet(providerId, pincode, capability)');
    expect(profileService).toContain('error instanceof ApiError && error.status === 404');
    expect(profileService).toContain("throw new Error('PROVIDER_SERVICEABILITY_UNVERIFIABLE')");
    expect(profileService).toContain('organizationId: value.organizationId');
    expect(profileService).not.toContain('ratingAvg: 0');
    expect(profileService).not.toContain('ratingCount: 0');

    expect(careDetail).toContain('fetchProviderProfile(providerId, { kind, pincode: selectedPincode })');
    expect(careDetail.indexOf('fetchProviderProfile(providerId')).toBeLessThan(
      careDetail.indexOf('fetchAppointmentServices({ providerId'),
    );
    expect(careDetail).toContain('requestGeneration');
    expect(careDetail).toContain('router.canGoBack()');
    expect(careDetail).toContain('router.replace(bookingRoute');

    expect(genericDetail).toContain('fetchProviderProfile(providerId, { kind, pincode: selectedPincode })');
    expect(genericDetail).toContain('router.replace(`/shop/');
    expect(genericDetail).toContain('router.replace(`/groomer/');
    expect(genericDetail).toContain('router.replace(`/vet/');
  });

  it('isolates local favourites by account and protects queued mutations across auth changes', () => {
    const favourites = source('src/context/FavouritesContext.tsx');

    expect(favourites).toContain("const GUEST_STORAGE_KEY = 'mypet_favourites_v4_guest'");
    expect(favourites).toContain("const ACCOUNT_STORAGE_PREFIX = 'mypet_favourites_v4_account:'");
    expect(favourites).toContain("const LEGACY_GUEST_STORAGE_KEY = 'mypet_favourites_v2_guest'");
    expect(favourites).toContain("const AMBIGUOUS_LEGACY_STORAGE_KEY = 'mypet_favourites_v3_local'");
    expect(favourites).toContain('accountStorageKey(accountId)');
    expect(favourites).toContain('loadAccountLocal(accountAtStart)');
    expect(favourites).toContain('loadGuestLocal(true)');
    expect(favourites).toContain('parseStored(LEGACY_GUEST_STORAGE_KEY)');
    expect(favourites).not.toContain('parseStored(AMBIGUOUS_LEGACY_STORAGE_KEY)');
    expect(favourites).toContain('apiClient.getAuthEpoch()');
    expect(favourites).toContain('loadGenerationRef');
    expect(favourites).toContain('mutationQueueRef');
    expect(favourites).toContain('const accountAtInvocation = accountId;');
    expect(favourites).toContain('const authEpochAtInvocation = apiClient.getAuthEpoch();');
    expect(favourites).toContain('if (!stillSameAccount()) return currentlyFavourite;');
    expect(favourites).toContain('if (migrationError instanceof ApiError && migrationError.status === 404) continue');
    expect(favourites).toContain('retryableLocalProducts.push(product)');
    expect(favourites).toContain('saveStored(GUEST_STORAGE_KEY, [])');
  });

  it('keeps saved state distinct from selected-PIN availability and allows unavailable removal', () => {
    const screen = source('src/app/favourites/index.tsx');

    expect(screen).toContain('fetchServiceableCommerceProduct(productId, selectedPincode)');
    expect(screen).toContain('fetchServiceableProductStore(shopId, selectedPincode)');
    expect(screen).toContain('error instanceof ApiError && error.status === 404');
    expect(screen).toContain('Saved but unavailable here');
    expect(screen).toContain('It remains saved until you remove it.');
    expect(screen).toContain('Remove from favourites');
    expect(screen).toContain("product.kind === 'PRODUCT' && product.commerceMode === 'COMMERCE'");
    expect(screen).toContain('operationalFailures');
    expect(screen).toContain('ResilientRemoteImage');
    expect(screen).toContain('await retryFavourites();\n      return;');
    expect(screen).not.toContain('shop.rating');
    expect(screen).not.toContain('shop.deliveryEta');
    expect(screen).not.toContain('shop.address');
  });

  it('keeps favourite and discovery controls accessible without hitSlop-only targets', () => {
    const favourites = source('src/app/favourites/index.tsx');
    const search = source('src/screens/search-screen.tsx');
    const home = source('src/screens/home-screen.tsx');

    expect(favourites).toContain('accessibilityState={{ selected: true }}');
    expect(favourites).toContain('width: touchTarget, height: touchTarget');
    expect(favourites).toContain('minHeight: touchTarget');
    expect(search).toContain('accessibilityLabel={`Search products serving PIN ${selectedPincode}`}');
    expect(search).toContain('minHeight: touchTarget');
    expect(home).toContain('accessibilityRole="button"');
  });

  it('keeps backend ownership and public provider filters authoritative', () => {
    const favouritesController = source('../../backend/src/main/kotlin/in/mypetnew/application/web/CustomerFavouriteController.kt');
    const publicCatalog = source('../../backend/src/main/kotlin/in/mypetnew/application/web/PublicCatalogController.kt');

    expect(favouritesController).toContain('Authorizer.requireRole(principal, Role.CUSTOMER)');
    expect(favouritesController).toContain('return principal.actorId');
    expect(publicCatalog).toContain('outlet.status == ProviderStatus.ACTIVE');
    expect(publicCatalog).toContain('(capability == null || capability in outlet.capabilities)');
    expect(publicCatalog).toContain('(pincodeFilter == null || pincodeFilter in outlet.servicePinCodes)');
    expect(publicCatalog).toContain('return PaginationHelper.paginate(visible, page, pageSize)');
  });
});
