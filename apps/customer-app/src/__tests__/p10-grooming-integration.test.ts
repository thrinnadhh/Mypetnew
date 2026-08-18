import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P10 integrated grooming journey', () => {
  it('connects P9 provider discovery to groomer detail, service selection and canonical slot discovery', () => {
    const discovery = source('src/app/grooming/index.tsx');
    const detailRoute = source('src/app/groomer/[id].tsx');
    const detail = source('src/screens/groomer-detail-screen.tsx');
    const slotRoute = source('src/app/groomer/[id]/slots.tsx');
    const slots = source('src/screens/groomer-slot-discovery-screen.tsx');

    expect(discovery).toContain("router.push(`/groomer/${encodeURIComponent(providerId)}`");
    expect(detailRoute).toContain('<GroomerDetailScreen />');
    expect(detail).toContain("pathname: '/groomer/[id]/slots'");
    expect(detail).toContain("params: { id: providerId, serviceId: service.id }");
    expect(slotRoute).toContain('<GroomerSlotDiscoveryScreen />');
    expect(slots).toContain("fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING')");
  });

  it('hands exact provider service slot timestamps and PIN into the existing P12 route', () => {
    const slots = source('src/screens/groomer-slot-discovery-screen.tsx');
    const p12 = source('src/screens/appointment-discovery-screen.tsx');
    const groomRoute = source('src/app/groom.tsx');

    expect(slots).toContain("pathname: '/groom'");
    expect(slots).toContain('providerId,');
    expect(slots).toContain('serviceId,');
    expect(slots).toContain('slotId: current.id');
    expect(slots).toContain('slotStartsAt: current.startsAt');
    expect(slots).toContain('slotEndsAt: current.endsAt');
    expect(slots).toContain('pincode: selectedPincode');

    expect(groomRoute).toContain('providerId || serviceId');
    expect(groomRoute).toContain('AppointmentDiscoveryScreen');
    expect(p12).toContain('slotId?: string | string[]');
    expect(p12).toContain('slotStartsAt?: string | string[]');
    expect(p12).toContain('slotEndsAt?: string | string[]');
    expect(p12).toContain('pincode?: string | string[]');
    expect(p12).toContain('sameHandoffSlot');
    expect(p12).toContain('Previously selected time changed');
    expect(p12).toContain('Selected in P10');
  });

  it('keeps booking creation and payment execution outside P10-owned screens', () => {
    const detail = source('src/screens/groomer-detail-screen.tsx');
    const slots = source('src/screens/groomer-slot-discovery-screen.tsx');

    for (const p10Source of [detail, slots]) {
      expect(p10Source).not.toContain('holdAppointmentSlot');
      expect(p10Source).not.toContain('/api/v1/customer/appointments');
      expect(p10Source).not.toContain('/appointments/payment');
      expect(p10Source).not.toContain('paymentMethod');
      expect(p10Source).not.toContain('confirmAppointmentHold');
    }
  });

  it('keeps transaction price authoritative on the backend and does not pass price in the P10 handoff', () => {
    const slots = source('src/screens/groomer-slot-discovery-screen.tsx');
    const adapter = source('src/services/appointment-booking.ts');
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/appointment/domain/AppointmentService.kt');

    expect(adapter).toContain('pricePaise');
    expect(adapter).toContain('SERVICE_PRICE_INVALID');
    expect(slots).not.toContain('price: current');
    expect(slots).not.toContain('amount:');
    expect(backend).toContain('offering.pricePaise');
  });

  it('registers the canonical slot route and keeps current P9 route fallback intact', () => {
    const navigation = source('src/navigation/customer-navigation.ts');
    const groomRoute = source('src/app/groom.tsx');

    expect(navigation).toContain("'/groomer/[id]/slots'");
    expect(groomRoute).toContain('<Redirect href="/grooming" />');
  });
});
