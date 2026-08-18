import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P11 veterinary discovery, services and slot contract', () => {
  it('keeps plain /vet provider-first while preserving the parameterized P12 booking handoff', () => {
    const route = source('src/app/vet.tsx');
    const discovery = source('src/screens/veterinary-discovery-screen.tsx');

    expect(route).toContain('return <VeterinaryDiscoveryScreen />');
    expect(route).toContain('providerId || serviceId || slotId');
    expect(route).toContain('AppointmentDiscoveryScreen');
    expect(discovery).toContain("fetchProviderPage('VET_HOSPITAL', INITIAL_MARKET, selectedPincode");
    expect(discovery).not.toContain('holdAppointmentSlot');
    expect(discovery).not.toContain('payment');
  });

  it('uses canonical veterinary capability aggregation, bounded pages and provider-ID dedupe', () => {
    const discovery = source('src/screens/veterinary-discovery-screen.tsx');
    const providerService = source('src/services/provider-discovery.ts');

    expect(providerService).toContain("VET_HOSPITAL: ['VETERINARY_CLINIC', 'VETERINARY_HOSPITAL']");
    expect(discovery).toContain('PROVIDER_DISCOVERY_PAGE_SIZE');
    expect(discovery).toContain('page: 0');
    expect(discovery).toContain('page: nextPage');
    expect(discovery).toContain('mergeUniqueProviders([], response.items)');
    expect(discovery).toContain('mergeUniqueProviders(current, response.items)');
    expect(providerService).toContain('unique.set(provider.id, provider)');
  });

  it('fails closed on city and PIN state and protects discovery races', () => {
    const discovery = source('src/screens/veterinary-discovery-screen.tsx');

    expect(discovery).toContain('if (!activeCity.featureFlags.allowVet)');
    expect(discovery).toContain("setState('feature_disabled')");
    expect(discovery).toContain('if (!SERVICE_PIN_PATTERN.test(selectedPincode))');
    expect(discovery).toContain("setState('invalid_location')");
    expect(discovery).toContain('requestGeneration.current + 1');
    expect(discovery).toContain('if (requestGeneration.current !== generation) return;');
    expect(discovery).toContain("loadFirstPage('refresh')");
    expect(discovery).toContain('Retry loading more');
  });

  it('validates provider and service authority before exposing veterinary slots', () => {
    const detail = source('src/screens/veterinary-provider-detail-screen.tsx');
    const slots = source('src/screens/veterinary-slot-discovery-screen.tsx');
    const profile = source('src/services/provider-profile.ts');

    expect(profile).toContain("case 'vet': return ['VETERINARY_CLINIC', 'VETERINARY_HOSPITAL']");
    expect(detail).toContain("fetchProviderProfile(providerId, { kind: 'vet', pincode: selectedPincode })");
    expect(detail).toContain("fetchAppointmentServices({ providerId, capability: 'VETERINARY' })");
    expect(detail).toContain("service.providerId !== providerId || service.capability !== 'VETERINARY'");
    expect(detail).toContain("pathname: '/vet/[slug]/slots'");
    expect(slots).toContain("fetchAppointmentServices({ providerId, capability: 'VETERINARY' })");
    expect(slots).toContain("fetchAvailableAppointmentSlots(providerId, serviceId, 'VETERINARY')");
    expect(slots).toContain('slot.providerId !== providerId || slot.offeringId !== serviceId');
  });

  it('uses Asia/Kolkata slot grouping, canonical slot freshness and a P12-only handoff', () => {
    const slots = source('src/screens/veterinary-slot-discovery-screen.tsx');
    const service = source('src/services/appointment-booking.ts');

    expect(service).toContain("APPOINTMENT_DISPLAY_TIME_ZONE = 'Asia/Kolkata'");
    expect(slots).toContain('timeZone: APPOINTMENT_DISPLAY_TIME_ZONE');
    expect(slots).toContain('sameSlot(chosen, current)');
    expect(slots).toContain("pathname: '/vet'");
    expect(slots).toContain('slotId: current.id');
    expect(slots).toContain('slotStartsAt: current.startsAt');
    expect(slots).toContain('slotEndsAt: current.endsAt');
    expect(slots).toContain('Selecting a time does not reserve or create an appointment.');
    expect(slots).not.toContain('holdAppointmentSlot');
  });

  it('keeps P11 controls accessible and makes no rating/distance/ETA claims', () => {
    const discovery = source('src/screens/veterinary-discovery-screen.tsx');
    const detail = source('src/screens/veterinary-provider-detail-screen.tsx');
    const slots = source('src/screens/veterinary-slot-discovery-screen.tsx');

    expect(discovery).toContain('accessibilityRole="button"');
    expect(discovery).toContain('width: touchTarget, height: touchTarget');
    expect(detail).toContain('accessibilityHint="Shows current available veterinary dates and times"');
    expect(slots).toContain('accessibilityState={{ selected:');
    expect(slots).toContain('minHeight: touchTarget');
    for (const value of [discovery, detail, slots]) {
      expect(value).not.toContain('rating');
      expect(value).not.toContain('distance');
      expect(value).not.toContain('ETA');
    }
  });
});
