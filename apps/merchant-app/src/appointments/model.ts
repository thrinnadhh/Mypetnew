import type { Href } from 'expo-router';
import type { StatusVariant } from '../design';
import type {
  MerchantAppointmentPaymentMethod,
  MerchantAppointmentPaymentStatus,
  MerchantAppointmentRequest,
  MerchantAppointmentStatus,
} from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function appointmentNotificationDestination(appointmentId: string): Href {
  return UUID.test(appointmentId)
    ? { pathname: '/appointments', params: { appointmentId } }
    : { pathname: '/dashboard' };
}

export function prioritizeAppointmentNavigation(
  requests: readonly MerchantAppointmentRequest[],
  appointmentId?: string,
): MerchantAppointmentRequest[] {
  if (!appointmentId) return [...requests];
  const selected = requests.find((request) => request.appointmentId === appointmentId);
  if (!selected) return [...requests];
  return [selected, ...requests.filter((request) => request.appointmentId !== appointmentId)];
}

export function appointmentStatusVariant(status: MerchantAppointmentStatus): StatusVariant {
  switch (status) {
    case 'BOOKED':
      return 'warning';
    case 'CONFIRMED':
      return 'info';
    case 'CHECKED_IN':
      return 'syncing';
    case 'IN_SERVICE':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'REJECTED':
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'error';
    case 'HOLD':
      return 'pending';
    case 'HOLD_EXPIRED':
    default:
      return 'neutral';
  }
}

export function appointmentStatusLabel(status: MerchantAppointmentStatus): string {
  switch (status) {
    case 'BOOKED':
      return 'Needs Attention';
    case 'CONFIRMED':
      return 'Confirmed';
    case 'CHECKED_IN':
      return 'Checked In';
    case 'IN_SERVICE':
      return 'In Service';
    case 'COMPLETED':
      return 'Completed';
    case 'REJECTED':
      return 'Rejected';
    case 'CANCELLED':
      return 'Cancelled';
    case 'NO_SHOW':
      return 'No Show';
    case 'HOLD':
      return 'Hold';
    case 'HOLD_EXPIRED':
      return 'Hold Expired';
    default:
      return (status as string).replaceAll('_', ' ');
  }
}

export function appointmentActionTitle(target: MerchantAppointmentStatus): string {
  switch (target) {
    case 'CONFIRMED':
      return 'Accept Booking';
    case 'REJECTED':
      return 'Reject';
    case 'CHECKED_IN':
      return 'Mark Checked In';
    case 'IN_SERVICE':
      return 'Start Service';
    case 'COMPLETED':
      return 'Complete Service';
    case 'NO_SHOW':
      return 'Mark No-Show';
    case 'CANCELLED':
      return 'Cancel Appointment';
    default:
      return (target as string).replaceAll('_', ' ');
  }
}

export function formatAppointmentPrice(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function formatAppointmentSchedule(startsAt: string, endsAt?: string): string {
  const startDate = new Date(startsAt);
  if (Number.isNaN(startDate.getTime())) return 'Time unavailable';

  const dateStr = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(startDate);

  const startTimeStr = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(startDate);

  if (endsAt) {
    const endDate = new Date(endsAt);
    if (!Number.isNaN(endDate.getTime())) {
      const endTimeStr = new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(endDate);
      return `${dateStr}, ${startTimeStr} – ${endTimeStr}`;
    }
  }

  return `${dateStr}, ${startTimeStr}`;
}

export function formatPaymentStatusLabel(
  method: MerchantAppointmentPaymentMethod,
  status: MerchantAppointmentPaymentStatus,
): string {
  if (method === 'PAY_AT_PROVIDER') return 'Pay at provider';
  switch (status) {
    case 'PAID':
      return 'Paid online';
    case 'REFUND_PENDING':
      return 'Paid · Refund pending';
    case 'REFUNDED':
      return 'Refunded';
    case 'REFUND_FAILED':
      return 'Refund needs attention';
    case 'FAILED':
      return 'Online payment failed';
    case 'EXPIRED':
      return 'Payment expired';
    default:
      return 'Online payment pending';
  }
}

export function formatPaymentStatusVariant(
  method: MerchantAppointmentPaymentMethod,
  status: MerchantAppointmentPaymentStatus,
): StatusVariant {
  if (method === 'PAY_AT_PROVIDER') return 'neutral';
  switch (status) {
    case 'PAID':
      return 'success';
    case 'REFUND_PENDING':
      return 'warning';
    case 'REFUNDED':
      return 'info';
    case 'REFUND_FAILED':
    case 'FAILED':
    case 'EXPIRED':
      return 'error';
    default:
      return 'pending';
  }
}

export function serviceCategoryFromServiceName(name: string): 'Grooming' | 'Veterinary' | 'Service' {
  const lower = name.toLowerCase();
  if (
    lower.includes('groom') ||
    lower.includes('bath') ||
    lower.includes('hair') ||
    lower.includes('spa') ||
    lower.includes('nail') ||
    lower.includes('trim') ||
    lower.includes('wash') ||
    lower.includes('brush')
  ) {
    return 'Grooming';
  }
  if (
    lower.includes('vet') ||
    lower.includes('vaccin') ||
    lower.includes('checkup') ||
    lower.includes('consult') ||
    lower.includes('doctor') ||
    lower.includes('health') ||
    lower.includes('dental') ||
    lower.includes('surgery') ||
    lower.includes('clinic')
  ) {
    return 'Veterinary';
  }
  return 'Service';
}
