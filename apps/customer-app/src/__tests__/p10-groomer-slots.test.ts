import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P10 groomer date and slot discovery contract', () => {
  it('uses a dedicated provider/service slot route and validates every route/context identifier', () => {
    const route = source('src/app/groomer/[id]/slots.tsx');
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(route).toContain("GroomerSlotDiscoveryScreen");
    expect(screen).toContain("id?: string | string[]");
    expect(screen).toContain("serviceId?: string | string[]");
    expect(screen).toContain('if (!providerId || !UUID_PATTERN.test(providerId))');
    expect(screen).toContain('if (!serviceId || !UUID_PATTERN.test(serviceId))');
    expect(screen).toContain('if (!SERVICE_PIN_PATTERN.test(selectedPincode))');
  });

  it('revalidates provider, PIN, service ownership and grooming capability before slot discovery', () => {
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(screen).toContain("fetchProviderProfile(providerId, { kind: 'groomer', pincode: selectedPincode })");
    expect(screen).toContain("fetchAppointmentServices({ providerId, capability: 'GROOMING' })");
    expect(screen).toContain('currentService.providerId !== providerId');
    expect(screen).toContain("currentService.capability !== 'GROOMING'");
    expect(screen).toContain("fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING')");
    expect(screen).toContain('slot.providerId !== providerId || slot.offeringId !== serviceId');
    expect(screen.indexOf('fetchProviderProfile(providerId')).toBeLessThan(screen.indexOf('fetchAvailableAppointmentSlots(providerId'));
  });

  it('derives available dates only from authoritative future slot Instants in the India display timezone', () => {
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');
    const service = source('src/services/appointment-booking.ts');

    expect(screen).toContain('APPOINTMENT_DISPLAY_TIME_ZONE');
    expect(screen).toContain('timeZone: APPOINTMENT_DISPLAY_TIME_ZONE');
    expect(screen).toContain('currentSlots.map((slot) => dateKey(slot.startsAt))');
    expect(screen).toContain('slots.filter((slot) => dateKey(slot.startsAt) === selectedDate)');
    expect(service).toContain("export const APPOINTMENT_DISPLAY_TIME_ZONE = 'Asia/Kolkata'");
    expect(service).toContain('startsAt: dto.startsAt');
    expect(service).toContain('endsAt: dto.endsAt');
    expect(service).toContain('const strictContract = Boolean(capability)');
    expect(service).toContain('const hasValidTimes = Number.isFinite(startsAtMs)');
    expect(service).toContain('if (!hasValidTimes && strictContract)');
    expect(service).toContain("throw contractError('SLOT_TIME_INVALID'");
    expect(service).toContain('if (hasValidTimes && startsAtMs <= nowMs) return null;');
    expect(service).not.toContain("replace('Z'");
  });

  it('guards provider/service/PIN/date races and invalidates selected slots when refreshed truth changes', () => {
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(screen).toContain('requestGeneration.current + 1');
    expect(screen).toContain('if (requestGeneration.current !== generation) return;');
    expect(screen).toContain('requestGeneration.current += 1');
    expect(screen).toContain('handoffGeneration.current += 1');
    expect(screen).toContain('sameCanonicalSlot(current, refreshed)');
    expect(screen).toContain('setSlotStale(true)');
    expect(screen).toContain('setSelectedSlot(null)');
    expect(screen).toContain("setSelectedDate(key)");
  });

  it('rechecks the exact selected slot before P12 handoff without reserving it', () => {
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(screen).toContain('const current = latest.find((slot) => slot.id === chosen.id)');
    expect(screen).toContain('!sameCanonicalSlot(chosen, current)');
    expect(screen).toContain("pathname: '/groom'");
    expect(screen).toContain('slotId: current.id');
    expect(screen).toContain('slotStartsAt: current.startsAt');
    expect(screen).toContain('slotEndsAt: current.endsAt');
    expect(screen).toContain('pincode: selectedPincode');
    expect(screen).toContain('Selection is not a reservation');
    expect(screen).not.toContain('holdAppointmentSlot');
    expect(screen).not.toContain('/api/v1/customer/appointments');
    expect(screen).not.toContain('/appointments/payment');
  });

  it('distinguishes empty, stale, removed-service, offline and retry states', () => {
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(screen).toContain("'service_unavailable'");
    expect(screen).toContain("'offline'");
    expect(screen).toContain("'error'");
    expect(screen).toContain('No future times available');
    expect(screen).toContain('Selected time is no longer available');
    expect(screen).toContain('Availability refresh failed');
    expect(screen).toContain('Retry refresh');
    expect(screen).toContain('Recheck availability');
  });

  it('uses accessible selected states and >=48dp controls for dates, slots and continuation', () => {
    const screen = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(screen).toContain('accessibilityRole="button"');
    expect(screen).toContain('accessibilityState={{ selected }}');
    expect(screen).toContain("'Selected date'");
    expect(screen).toContain("'Selected time'");
    expect(screen).toContain('minHeight: touchTarget');
    expect(screen).toContain('minWidth: touchTarget');
    expect(screen).toContain('label="Continue to booking"');
    expect(screen).toContain('disabled={!selectedSlot || checkingFreshness}');
  });
});
