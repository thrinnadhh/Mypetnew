import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P12 appointment booking contract', () => {
  it('consumes the exact P10/P11 provider, service, slot and PIN handoff before booking', () => {
    const screen = source('src/screens/appointment-discovery-screen.tsx');

    expect(screen).toContain('preferredProviderId');
    expect(screen).toContain('preferredServiceId');
    expect(screen).toContain('preferredSlotId');
    expect(screen).toContain('preferredSlotStartsAt');
    expect(screen).toContain('preferredSlotEndsAt');
    expect(screen).toContain('preferredPincode');
    expect(screen).toContain('sameHandoffSlot');
    expect(screen).toContain('preferredPincode === selectedPincode');
    expect(screen).toContain('setHandoffSlotStale(!selected)');
  });

  it('requires authentication and an owned selected pet before creating a hold', () => {
    const screen = source('src/screens/appointment-discovery-screen.tsx');

    expect(screen).toContain("requireAuth({ action: 'BOOKING', returnTo: route })");
    expect(screen).toContain('if (!authenticated || !user || !session) return;');
    expect(screen).toContain('if (!selectedPetId)');
    expect(screen).toContain('holdAppointmentSlot({');
    expect(screen).toContain('userId: user.id');
    expect(screen).toContain('petId: selectedPetId');
    expect(screen).toContain('accessToken: session.accessToken');
  });

  it('keeps appointment creation server authoritative and idempotent', () => {
    const booking = source('src/services/appointment-booking.ts');
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/appointment/domain/AppointmentService.kt');
    const controller = source('../../backend/src/main/kotlin/in/mypetnew/application/web/AppointmentControllers.kt');

    expect(booking).toContain("'Idempotency-Key': idempotencyKey");
    expect(booking).toContain('outletId: input.slot.providerId');
    expect(booking).toContain('serviceId: input.slot.offeringId');
    expect(booking).toContain('slotId: input.slot.id');
    expect(booking).not.toContain('pricePaise: input.slot');

    expect(controller).toContain('@RequestHeader("Idempotency-Key") idempotencyKey: String');
    expect(backend).toContain('val offering = activeOffering(serviceId)');
    expect(backend).toContain('if (offering.outletId != outletId) unavailable()');
    expect(backend).toContain('it.serviceId == serviceId && it.active');
    expect(backend).toContain('customerData.getPet(customer.actorId, petId)');
    expect(backend).toContain('offering.pricePaise');
    expect(backend).toContain('persistence.hold(appointment, idempotencyKey, fingerprint, now)');
  });

  it('prevents slot oversell and replays the same successful request', () => {
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/appointment/domain/AppointmentService.kt');
    const apiTest = source('../../backend/src/test/kotlin/in/mypetnew/api/CustomerAppointmentApiTest.kt');

    expect(backend).toContain('if (appointments.values.any { it.slotId == appointment.slotId && it.status in OCCUPYING_STATUSES }) slotUnavailable()');
    expect(backend).toContain('holds.execute("appointment:${appointment.customerId}", idempotencyKey, requestFingerprint)');
    expect(apiTest).toContain('header("Idempotency-Key", "appointment-api-hold")');
    expect(apiTest).toContain('jsonPath("$.appointmentId") { value(appointmentId) }');
    expect(apiTest).toContain('foreign pet requests');
  });

  it('preserves a clean P13 boundary after the authoritative appointment hold', () => {
    const screen = source('src/screens/appointment-discovery-screen.tsx');

    expect(screen).toContain("pathname: '/appointments/payment'");
    expect(screen).toContain('appointmentId,');
    expect(screen).toContain('paymentMethod,');
    expect(screen).not.toContain('initiateAppointmentPayment');
    expect(screen).not.toContain('openCashfreeOrder');
    expect(screen).not.toContain('confirmAppointmentHold');
  });
});
