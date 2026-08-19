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
    expect(screen).toContain('pincode: selectedPincode');
    expect(screen).toContain('accessToken: session.accessToken');
  });

  it('keeps appointment creation server authoritative PIN-bound and idempotent', () => {
    const booking = source('src/services/appointment-booking.ts');
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/appointment/domain/AppointmentService.kt');
    const controller = source('../../backend/src/main/kotlin/in/mypetnew/application/web/AppointmentControllers.kt');

    expect(booking).toContain("'Idempotency-Key': idempotencyKey");
    expect(booking).toContain('outletId: input.slot.providerId');
    expect(booking).toContain('serviceId: input.slot.offeringId');
    expect(booking).toContain('slotId: input.slot.id');
    expect(booking).toContain('pincode: input.pincode');
    expect(booking).not.toContain('pricePaise: input.slot');

    expect(controller).toContain('@RequestHeader("Idempotency-Key") idempotencyKey: String');
    expect(controller).toContain('servicePincode = request.pincode');
    expect(backend).toContain('val offering = activeOffering(serviceId)');
    expect(backend).toContain('if (offering.outletId != outletId) unavailable()');
    expect(backend).toContain('if (outlet.organizationId != offering.organizationId) unavailable()');
    expect(backend).toContain('servicePincode !in outlet.servicePinCodes');
    expect(backend).toContain('customerData.getPet(customer.actorId, petId)');
    expect(backend).toContain('offering.pricePaise');
    expect(backend).toContain('persistence.hold(appointment, idempotencyKey, fingerprint, now)');
  });

  it('uses shared database serialization for slot occupancy and executable concurrency proof', () => {
    const jdbc = source('../../backend/src/main/kotlin/in/mypetnew/appointment/infrastructure/JdbcAppointmentPersistence.kt');
    const migration = source('../../backend/src/main/resources/db/migration/V17__service_appointments.sql');
    const concurrencyTest = source('../../backend/src/test/kotlin/in/mypetnew/appointment/JdbcAppointmentPersistenceConcurrencyTest.kt');

    expect(jdbc).toContain('SELECT id FROM mypet.service_slot');
    expect(jdbc).toContain('FOR UPDATE');
    expect(jdbc).toContain("status IN ('HOLD','BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE')");
    expect(migration).toContain('UNIQUE (customer_id, idempotency_key)');
    expect(concurrencyTest).toContain('two persistence instances cannot acquire the same slot for different customers');
    expect(concurrencyTest).toContain('concurrent same customer idempotency replay returns one stored appointment');
    expect(concurrencyTest).toContain('CountDownLatch(2)');
    expect(concurrencyTest).toContain('assertEquals(1, activeOccupancyCount(database, slotId))');
  });

  it('prevents stale async hold responses from navigating after booking intent changes', () => {
    const screen = source('src/screens/appointment-discovery-screen.tsx');

    expect(screen).toContain('bookingRequestGeneration');
    expect(screen).toContain('bookingInFlightRef');
    expect(screen).toContain('sameBookingContext');
    expect(screen).toContain('if (!isCurrentRequest()) return;');
    expect(screen).toContain('if (bookingInFlightRef.current) return;');
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
