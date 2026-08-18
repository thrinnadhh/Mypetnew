import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P10 groomer detail and service selection contract', () => {
  it('keeps the P9 handoff on a dedicated groomer detail route', () => {
    const discovery = source('src/app/grooming/index.tsx');
    const route = source('src/app/groomer/[id].tsx');

    expect(discovery).toContain("router.push(`/groomer/${encodeURIComponent(providerId)}`");
    expect(route).toContain("import GroomerDetailScreen from '@/screens/groomer-detail-screen'");
    expect(route).toContain('<GroomerDetailScreen />');
  });

  it('validates feature, provider identity and selected PIN before loading public services', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');

    expect(detail).toContain('if (!activeCity.featureFlags.allowGrooming)');
    expect(detail).toContain('if (!providerId || !UUID_PATTERN.test(providerId))');
    expect(detail).toContain('if (!SERVICE_PIN_PATTERN.test(selectedPincode))');
    expect(detail).toContain("fetchProviderProfile(providerId, { kind: 'groomer', pincode: selectedPincode })");
    expect(detail).toContain("fetchAppointmentServices({ providerId, capability: 'GROOMING' })");
    expect(detail.indexOf('fetchProviderProfile(providerId')).toBeLessThan(
      detail.indexOf('fetchAppointmentServices({ providerId'),
    );
    expect(detail).toContain("profile.capabilities.includes('GROOMING')");
    expect(detail).toContain("service.providerId !== providerId || service.capability !== 'GROOMING'");
  });

  it('protects provider and PIN changes from stale responses and offers retry/back recovery', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');

    expect(detail).toContain('requestGeneration.current + 1');
    expect(detail).toContain('requestGeneration.current = generation');
    expect(detail).toContain('if (requestGeneration.current !== generation) return;');
    expect(detail).toContain('requestGeneration.current += 1');
    expect(detail).toContain('[activeCity.featureFlags.allowGrooming, providerId, selectedPincode]');
    expect(detail).toContain("router.replace('/grooming' as never)");
    expect(detail).toContain('actionLabel="Retry"');
    expect(detail).toContain('openLocationModal');
  });

  it('renders only public provider identity plus authoritative service fields without invented metadata', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');

    expect(detail).toContain('{provider.name}');
    expect(detail).toContain('{service.name}');
    expect(detail).toContain('{service.description}');
    expect(detail).toContain('{service.durationMinutes} minutes');
    expect(detail).toContain('servicePriceLabel');
    expect(detail).not.toContain('ratingAvg');
    expect(detail).not.toContain('ratingCount');
    expect(detail).not.toContain('Verified');
    expect(detail).not.toContain('Live booking');
    expect(detail).not.toContain('ResilientRemoteImage');
    expect(detail).not.toContain('distance');
    expect(detail).not.toContain('ETA');
  });

  it('selects one provider-owned grooming service and routes to P10 slot discovery', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');

    expect(detail).toContain("service.providerId !== providerId || service.capability !== 'GROOMING'");
    expect(detail).toContain("pathname: '/groomer/[id]/slots'");
    expect(detail).toContain("params: { id: providerId, serviceId: service.id }");
    expect(detail).toContain('No grooming services published');
  });

  it('keeps detail/service selection guest-safe and free of booking/payment side effects', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');

    expect(detail).not.toContain('useAuth(');
    expect(detail).not.toContain('requireAuth');
    expect(detail).not.toContain('holdAppointmentSlot');
    expect(detail).not.toContain('/api/v1/customer/appointments');
    expect(detail).not.toContain('/appointments/payment');
    expect(detail).not.toContain('paymentMethod');
  });

  it('keeps interactive service controls at accessible touch sizes with descriptive labels', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');

    expect(detail).toContain('accessibilityRole="button"');
    expect(detail).toContain('accessibilityLabel={`${service.name}, ${service.durationMinutes} minutes, ${priceLabel}. Choose service.`}');
    expect(detail).toContain('accessibilityHint="Shows current available dates and appointment times"');
    expect(detail).toContain('minHeight: 112');
    expect(detail).toContain('width: touchTarget');
    expect(detail).toContain('height: touchTarget');
    expect(detail).toContain('flexShrink: 1');
  });
});
