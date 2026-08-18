import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P9 grooming discovery contract', () => {
  it('routes every Home grooming entry into canonical provider discovery and suppresses live grooming preview when disabled', () => {
    const home = source('src/screens/home-screen.tsx');
    const legacyRoute = source('src/app/groom.tsx');

    expect(home).toContain("{ id: 'grooming', label: 'Grooming Services', route: '/grooming'");
    expect(home).toContain("router.push('/grooming' as never)");
    expect(home).toContain('activeCity.featureFlags.allowGrooming');
    expect(home).toContain("? fetchProviderPage('GROOMER'");
    expect(home).toContain(': Promise.resolve({ items: [], page: 0');
    expect(home).toContain('activeCity.featureFlags.allowGrooming && liveGroomerCards.length > 0');

    expect(legacyRoute).toContain('providerId || serviceId');
    expect(legacyRoute).toContain('AppointmentDiscoveryScreen');
    expect(legacyRoute).toContain('<Redirect href="/grooming" />');
  });

  it('uses only bounded serviceable GROOMER pages and canonical-ID deduplication', () => {
    const screen = source('src/app/grooming/index.tsx');
    const discovery = source('src/services/provider-discovery.ts');

    expect(screen).toContain("fetchProviderPage('GROOMER', INITIAL_MARKET, selectedPincode");
    expect(screen).toContain('PROVIDER_DISCOVERY_PAGE_SIZE');
    expect(screen).toContain('page: 0');
    expect(screen).toContain('page: nextPage');
    expect(screen).toContain('mergeUniqueProviders([], response.items)');
    expect(screen).toContain('mergeUniqueProviders(current, response.items)');
    expect(screen).toContain('setNextPage(response.page + 1)');
    expect(screen).not.toContain('fetchProviders(');

    expect(discovery).toContain("GROOMER: ['GROOMING']");
    expect(discovery).toContain('requireValidServicePincode');
    expect(discovery).toContain('PROVIDER_DISCOVERY_PAGE_SIZE = 20');
    expect(discovery).toContain('mergeUniqueProviders');
    expect(discovery).toContain('unique.set(provider.id, provider)');
  });

  it('fails closed on feature availability and invalid location without issuing discovery calls first', () => {
    const screen = source('src/app/grooming/index.tsx');

    expect(screen).toContain("type LoadState = 'loading' | 'ready' | 'offline' | 'error' | 'feature_disabled' | 'invalid_location'");
    expect(screen).toContain('if (!activeCity.featureFlags.allowGrooming)');
    expect(screen).toContain("setState('feature_disabled')");
    expect(screen).toContain('if (!SERVICE_PIN_PATTERN.test(selectedPincode))');
    expect(screen).toContain("setState('invalid_location')");
    expect(screen.indexOf('if (!activeCity.featureFlags.allowGrooming)')).toBeLessThan(
      screen.indexOf("fetchProviderPage('GROOMER'"),
    );
    expect(screen.indexOf('if (!SERVICE_PIN_PATTERN.test(selectedPincode))')).toBeLessThan(
      screen.indexOf("fetchProviderPage('GROOMER'"),
    );
    expect(screen).toContain('openLocationModal');
  });

  it('protects PIN changes, refresh, pagination and unmount from stale responses', () => {
    const screen = source('src/app/grooming/index.tsx');

    expect(screen).toContain('requestGeneration.current + 1');
    expect(screen).toContain('requestGeneration.current = generation');
    expect(screen).toContain('if (requestGeneration.current !== generation) return;');
    expect(screen).toContain('requestGeneration.current += 1');
    expect(screen).toContain('loadingMoreRef.current');
    expect(screen).toContain("loadFirstPage('refresh')");
    expect(screen).toContain('<RefreshControl');
    expect(screen).toContain('Retry refresh');
    expect(screen).toContain('Retry loading more');
    expect(screen).toContain('[activeCity.featureFlags.allowGrooming, selectedPincode]');
    expect(screen).toContain("if (mode === 'initial') {\n      setProviders([]);\n      setHasNext(false);\n      setNextPage(1);");
  });

  it('distinguishes loading, empty, offline, server error, pagination error and refresh error states', () => {
    const screen = source('src/app/grooming/index.tsx');

    expect(screen).toContain("state === 'loading'");
    expect(screen).toContain("state === 'offline'");
    expect(screen).toContain("state === 'error'");
    expect(screen).toContain('No groomers serve this PIN yet');
    expect(screen).toContain('loadMoreError');
    expect(screen).toContain('refreshError');
    expect(screen).toContain('isOfflineError(error)');
    expect(screen).toContain('All serviceable groomers loaded.');
  });

  it('keeps P9 provider-first and truthful with no service, slot, payment, image, rating, distance or ETA invention', () => {
    const screen = source('src/app/grooming/index.tsx');
    const resilientImage = source('src/components/ui/resilient-remote-image.tsx');

    expect(screen).toContain('Serves PIN ${selectedPincode}');
    expect(screen).toContain("router.push(`/groomer/${encodeURIComponent(providerId)}`");
    expect(screen).not.toContain('fetchAppointmentServices');
    expect(screen).not.toContain('fetchAvailableAppointmentSlots');
    expect(screen).not.toContain('price');
    expect(screen).not.toContain('duration');
    expect(screen).not.toContain('rating');
    expect(screen).not.toContain('distance');
    expect(screen).not.toContain('ETA');
    expect(screen).not.toContain('ResilientRemoteImage');
    expect(screen).not.toContain('DEMO_MEDIA');
    expect(screen).not.toContain('slot');
    expect(screen).not.toContain('payment');
    expect(resilientImage).toContain('const effectiveFallback = appConfig.allowDemoMode');
    expect(resilientImage).toContain('if (!appConfig.allowDemoMode && DEMO_MEDIA_URIS.has(candidate)) return undefined;');
  });

  it('keeps controls accessible and responsive for long provider content', () => {
    const screen = source('src/app/grooming/index.tsx');
    const header = source('src/components/ui/screen-header.tsx');
    const button = source('src/components/ui/primary-button.tsx');

    expect(screen).toContain('accessibilityRole="button"');
    expect(screen).toContain('Open groomer details.');
    expect(screen).toContain('backLabel="Back from grooming discovery"');
    expect(screen).toContain('minHeight: 104');
    expect(screen).toContain('width: touchTarget, height: touchTarget');
    expect(screen).toContain('flexShrink: 1');
    expect(screen).toContain('flexGrow: 1');
    expect(header).toContain('width: touchTarget');
    expect(header).toContain('height: touchTarget');
    expect(button).toContain('minHeight: touchTarget');
  });

  it('keeps the backend public outlet endpoint authoritative for activity, capability, PIN, stable ordering, pagination and minimization', () => {
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/application/web/PublicCatalogController.kt');
    const apiTest = source('../../backend/src/test/kotlin/in/mypetnew/api/PublicCatalogApiTest.kt');

    expect(backend).toContain('outlet.status == ProviderStatus.ACTIVE');
    expect(backend).toContain('(capability == null || capability in outlet.capabilities)');
    expect(backend).toContain('(pincodeFilter == null || pincodeFilter in outlet.servicePinCodes)');
    expect(backend).toContain('sortedWith(compareBy<ProviderOutlet> { it.name.lowercase() }.thenBy { it.id.toString() })');
    expect(backend).toContain('return PaginationHelper.paginate(visible, page, pageSize)');
    expect(backend).toContain('pageSize !in 1..100');
    expect(backend).toContain('data class PublicOutletSummary(');
    expect(backend).not.toContain('data class PublicOutletSummary(\n    val ownerActorId');

    expect(apiTest).toContain('ACTIVE only & q case-insensitive search');
    expect(apiTest).toContain('Exact capability filter matching');
    expect(apiTest).toContain('Unapproved/inactive outlet -> 404');
    expect(apiTest).toContain('Data minimization verification');
  });

  it('preserves fail-closed direct groomer validation for P10 handoff', () => {
    const profile = source('src/services/provider-profile.ts');
    const detail = source('src/screens/live-care-provider-detail-screen.tsx');

    expect(profile).toContain("case 'groomer': return ['GROOMING']");
    expect(profile).toContain('fetchPublicOutlet(providerId, pincode, capability)');
    expect(profile).toContain('requireValidServicePincode');
    expect(profile).toContain("throw new Error('PROVIDER_CAPABILITY_MISMATCH')");
    expect(profile).toContain("throw new Error('PROVIDER_SERVICEABILITY_UNVERIFIABLE')");
    expect(detail).toContain('fetchProviderProfile(providerId, { kind, pincode: selectedPincode })');
    expect(detail.indexOf('fetchProviderProfile(providerId')).toBeLessThan(
      detail.indexOf('fetchAppointmentServices({ providerId'),
    );
  });
});
