import type { Href } from 'expo-router';
import type { MerchantAppointmentRequest } from './api';

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
