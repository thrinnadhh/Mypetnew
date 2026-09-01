import type { MerchantAppointmentRequest } from './api';
import {
  appointmentActionTitle,
  appointmentNotificationDestination,
  appointmentStatusLabel,
  appointmentStatusVariant,
  formatAppointmentPrice,
  formatAppointmentSchedule,
  formatPaymentStatusLabel,
  formatPaymentStatusVariant,
  prioritizeAppointmentNavigation,
  serviceCategoryFromServiceName,
} from './model';

function request(appointmentId: string): MerchantAppointmentRequest {
  return {
    appointmentId,
    outletId: 'outlet-1',
    serviceId: 'service-1',
    slotId: 'slot-1',
    petName: 'Milo',
    serviceName: 'Bath & Haircut',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T10:45:00Z',
    status: 'BOOKED',
    paymentMethod: 'PAY_AT_PROVIDER',
    paymentStatus: 'NOT_REQUIRED',
    pricePaise: 50000,
    currency: 'INR',
    createdAt: '2026-08-31T10:00:00Z',
    updatedAt: '2026-08-31T10:00:00Z',
  };
}

describe('appointment model helpers', () => {
  it('navigates dashboard and notifications to the existing appointments route', () => {
    expect(appointmentNotificationDestination('00000000-0000-4000-8000-000000000001')).toEqual({
      pathname: '/appointments',
      params: { appointmentId: '00000000-0000-4000-8000-000000000001' },
    });
  });

  it('prioritizes only an appointment returned by the canonical appointment API and never fabricates one', () => {
    const canonical = [request('appointment-1'), request('appointment-2')];
    expect(prioritizeAppointmentNavigation(canonical, 'appointment-2').map((item) => item.appointmentId)).toEqual([
      'appointment-2',
      'appointment-1',
    ]);
    expect(prioritizeAppointmentNavigation(canonical, 'missing')).toEqual(canonical);
  });

  it('returns correct status variants and labels', () => {
    expect(appointmentStatusVariant('BOOKED')).toBe('warning');
    expect(appointmentStatusVariant('CONFIRMED')).toBe('info');
    expect(appointmentStatusVariant('CHECKED_IN')).toBe('syncing');
    expect(appointmentStatusVariant('IN_SERVICE')).toBe('info');
    expect(appointmentStatusVariant('COMPLETED')).toBe('success');
    expect(appointmentStatusVariant('REJECTED')).toBe('error');
    expect(appointmentStatusVariant('CANCELLED')).toBe('error');
    expect(appointmentStatusVariant('NO_SHOW')).toBe('error');

    expect(appointmentStatusLabel('BOOKED')).toBe('Needs Attention');
    expect(appointmentStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(appointmentStatusLabel('CHECKED_IN')).toBe('Checked In');
    expect(appointmentStatusLabel('IN_SERVICE')).toBe('In Service');
    expect(appointmentStatusLabel('COMPLETED')).toBe('Completed');
    expect(appointmentStatusLabel('REJECTED')).toBe('Rejected');
    expect(appointmentStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(appointmentStatusLabel('NO_SHOW')).toBe('No Show');
  });

  it('returns readable action titles', () => {
    expect(appointmentActionTitle('CONFIRMED')).toBe('Accept Booking');
    expect(appointmentActionTitle('REJECTED')).toBe('Reject');
    expect(appointmentActionTitle('CHECKED_IN')).toBe('Mark Checked In');
    expect(appointmentActionTitle('IN_SERVICE')).toBe('Start Service');
    expect(appointmentActionTitle('COMPLETED')).toBe('Complete Service');
    expect(appointmentActionTitle('NO_SHOW')).toBe('Mark No-Show');
    expect(appointmentActionTitle('CANCELLED')).toBe('Cancel Appointment');
  });

  it('formats price in INR currency correctly', () => {
    expect(formatAppointmentPrice(149900)).toBe('₹1499.00');
    expect(formatAppointmentPrice(0)).toBe('₹0.00');
  });

  it('formats appointment schedule strings with range and fallbacks', () => {
    expect(formatAppointmentSchedule('invalid-date')).toBe('Time unavailable');
    const formatted = formatAppointmentSchedule('2026-09-01T10:00:00Z', '2026-09-01T10:45:00Z');
    expect(formatted).toContain('1 Sept');
    expect(formatted).toContain('–');

    const singleTime = formatAppointmentSchedule('2026-09-01T10:00:00Z');
    expect(singleTime).toContain('1 Sept');
    expect(singleTime).not.toContain('–');
  });

  it('formats payment status labels and variants correctly', () => {
    expect(formatPaymentStatusLabel('PAY_AT_PROVIDER', 'NOT_REQUIRED')).toBe('Pay at provider');
    expect(formatPaymentStatusVariant('PAY_AT_PROVIDER', 'NOT_REQUIRED')).toBe('neutral');

    expect(formatPaymentStatusLabel('ONLINE_PAYMENT', 'PAID')).toBe('Paid online');
    expect(formatPaymentStatusVariant('ONLINE_PAYMENT', 'PAID')).toBe('success');

    expect(formatPaymentStatusLabel('ONLINE_PAYMENT', 'REFUND_PENDING')).toBe('Paid · Refund pending');
    expect(formatPaymentStatusVariant('ONLINE_PAYMENT', 'REFUND_PENDING')).toBe('warning');

    expect(formatPaymentStatusLabel('ONLINE_PAYMENT', 'REFUNDED')).toBe('Refunded');
    expect(formatPaymentStatusVariant('ONLINE_PAYMENT', 'REFUNDED')).toBe('info');

    expect(formatPaymentStatusLabel('ONLINE_PAYMENT', 'FAILED')).toBe('Online payment failed');
    expect(formatPaymentStatusVariant('ONLINE_PAYMENT', 'FAILED')).toBe('error');

    expect(formatPaymentStatusLabel('ONLINE_PAYMENT', 'EXPIRED')).toBe('Payment expired');
    expect(formatPaymentStatusVariant('ONLINE_PAYMENT', 'EXPIRED')).toBe('error');

    expect(formatPaymentStatusLabel('ONLINE_PAYMENT', 'PENDING')).toBe('Online payment pending');
    expect(formatPaymentStatusVariant('ONLINE_PAYMENT', 'PENDING')).toBe('pending');
  });

  it('detects service category from name', () => {
    expect(serviceCategoryFromServiceName('Full Grooming Bath')).toBe('Grooming');
    expect(serviceCategoryFromServiceName('Spa and Hair Trim')).toBe('Grooming');
    expect(serviceCategoryFromServiceName('Annual Rabies Vaccination')).toBe('Veterinary');
    expect(serviceCategoryFromServiceName('Vet Doctor Health Checkup')).toBe('Veterinary');
    expect(serviceCategoryFromServiceName('General Boarding')).toBe('Service');
  });
});
