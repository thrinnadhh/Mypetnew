import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('P13 appointment payment and history contract', () => {
  it('loads payment review from the authenticated server appointment instead of trusting route money or method', () => {
    const payment = source('src/app/appointments/payment.tsx');

    expect(payment).toContain('fetchAppointmentDetails(appointmentId, session.accessToken)');
    expect(payment).toContain('appointment?.paymentMethod ?? routePaymentMethod');
    expect(payment).toContain('appointment?.priceAmount ?? routeAmount');
    expect(payment).toContain('appointment?.serviceName');
    expect(payment).toContain('appointment?.providerName');
    expect(payment).toContain('appointment?.petName');
    expect(payment).toContain('MyPet is loading the server-stored appointment, price and payment method.');
  });

  it('treats Cashfree callbacks as signals and verifies canonical backend payment and appointment state', () => {
    const payment = source('src/app/appointments/payment.tsx');
    const service = source('src/services/customer-payments.ts');

    expect(payment).toContain('waitForPaymentOutcome(payment.paymentId, 30, 2_000, action.userId)');
    expect(payment).toContain("verified.referenceType !== 'APPOINTMENT'");
    expect(payment).toContain('verified.referenceId !== action.appointmentId');
    expect(payment).toContain('const canonical = await fetchAppointmentDetails(action.appointmentId, action.accessToken)');
    expect(payment).toContain('Payment captured · refund pending');
    expect(service).toContain('The Cashfree native callback is never payment truth');
    expect(service).toContain('fetchPaymentStatus(paymentId)');
    expect(service).toContain("latest.status === 'CAPTURED'");
    expect(service).toContain('Payment initiation returned a different appointment reference.');
  });

  it('recovers an existing appointment payment only for the current account', () => {
    const payment = source('src/app/appointments/payment.tsx');
    const service = source('src/services/customer-payments.ts');
    const recovery = source('src/services/appointment-payment-recovery.ts');
    const auth = source('src/context/AuthContext.tsx');

    expect(payment).toContain('loadPendingAppointmentPayment(expectedUserId)');
    expect(payment).toContain('recovery?.customerId === expectedUserId');
    expect(payment).toContain('fetchPaymentStatus(recoveryAtStart.paymentId)');
    expect(payment).toContain('Resume payment');
    expect(service).toContain('rememberPendingAppointmentPayment(payment.paymentId, appointmentId, customerId)');
    expect(recovery).toContain("RECOVERY_PREFIX = 'mypet.customer.pending-appointment-payment.v2.'");
    expect(recovery).toContain('parsed.customerId !== customerId');
    expect(auth).toContain('clearAppointmentRecovery(previousAccountId)');
  });

  it('invalidates in-flight payment actions when account, token or appointment identity changes', () => {
    const payment = source('src/app/appointments/payment.tsx');

    expect(payment).toContain('paymentGenerationRef.current += 1');
    expect(payment).toContain('samePaymentContext(paymentContextRef.current, action)');
    expect(payment).toContain('if (!isCurrentPaymentAction(action)) return;');
    expect(payment).toContain('paymentInFlightRef.current');
  });

  it('does not relaunch payment for an appointment already beyond the hold step', () => {
    const payment = source('src/app/appointments/payment.tsx');

    expect(payment).toContain("appointment.status !== 'SLOT_HELD'");
    expect(payment).toContain('Appointment is no longer payable');
    expect(payment).toContain("appointment.paymentStatus !== 'PENDING'");
  });

  it('loads complete bounded appointment history page-by-page with account-scoped caching', () => {
    const history = source('src/services/customer-history.ts');

    expect(history).toContain('HISTORY_PAGE_SIZE = 20');
    expect(history).toContain('MAX_HISTORY_PAGES = 50');
    expect(history).toContain('for (let page = 0; page < MAX_HISTORY_PAGES; page += 1)');
    expect(history).toContain('fetchAppointmentPage(page, accessToken)');
    expect(history).toContain('if (!payload.hasNext)');
    expect(history).toContain('unique.set(mapped.id, mapped)');
    expect(history).toContain('const cacheKey = `${CACHE_PREFIX}${customerId}`');
    expect(history).not.toContain('appointments?page=0&pageSize=100');
  });

  it('keeps backend appointment history and detail customer-owned', () => {
    const controller = source('../../backend/src/main/kotlin/in/mypetnew/application/web/AppointmentControllers.kt');
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/appointment/domain/AppointmentService.kt');
    const apiTest = source('../../backend/src/test/kotlin/in/mypetnew/api/CustomerAppointmentApiTest.kt');

    expect(controller).toContain('appointments.get(customer(authentication), appointmentId)');
    expect(controller).toContain('appointments.list(customer(authentication), page, pageSize)');
    expect(backend).toContain('appointments[appointmentId]?.takeIf { it.customerId == customerId }');
    expect(backend).toContain('appointments.values.filter { it.customerId == customerId }');
    expect(apiTest).toContain('jsonPath("$.code") { value("RESOURCE_NOT_FOUND") }');
  });
});
