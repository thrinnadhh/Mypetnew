import type { MerchantAppointmentRequest } from './api';
import { appointmentNotificationDestination, prioritizeAppointmentNavigation } from './model';

function request(appointmentId: string): MerchantAppointmentRequest {
  return {
    appointmentId,
    outletId: 'outlet-1',
    serviceId: 'service-1',
    slotId: 'slot-1',
    petName: 'Milo',
    serviceName: 'Bath',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T10:30:00Z',
    status: 'BOOKED',
    paymentMethod: 'PAY_AT_PROVIDER',
    paymentStatus: 'NOT_REQUIRED',
    pricePaise: 50000,
    currency: 'INR',
    createdAt: '2026-08-31T10:00:00Z',
    updatedAt: '2026-08-31T10:00:00Z',
  };
}

describe('M11 appointment navigation', () => {
  it('navigates dashboard and notifications to the existing appointments route', () => {
    expect(appointmentNotificationDestination('00000000-0000-4000-8000-000000000001')).toEqual({
      pathname: '/appointments',
      params: { appointmentId: '00000000-0000-4000-8000-000000000001' },
    });
  });

  it('prioritizes only an appointment returned by the canonical appointment API and never fabricates one', () => {
    const canonical = [request('appointment-1'), request('appointment-2')];
    expect(prioritizeAppointmentNavigation(canonical, 'appointment-2').map((item) => item.appointmentId))
      .toEqual(['appointment-2', 'appointment-1']);
    expect(prioritizeAppointmentNavigation(canonical, 'missing')).toEqual(canonical);
  });
});
