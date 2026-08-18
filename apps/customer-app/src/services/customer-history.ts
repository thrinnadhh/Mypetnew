import AsyncStorage from '@react-native-async-storage/async-storage';
import { appConfig } from '@/utils/app-config';

export type HistoryAppointmentStatus =
  | 'SLOT_HELD'
  | 'PENDING_PROVIDER'
  | 'PAID'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';
export type AppointmentTabCategory = 'upcoming' | 'past' | 'cancelled';
export type AppointmentPaymentMethod = 'PAY_AT_PROVIDER' | 'ONLINE_PAYMENT';
export type AppointmentPaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';

export interface CustomerAppointmentRecord {
  id: string;
  providerName: string;
  providerId: string;
  serviceName: string;
  offeringId?: string;
  slotId?: string;
  petName: string;
  petId?: string;
  slotStartsAt: string;
  slotEndsAt: string;
  status: HistoryAppointmentStatus;
  paymentMethod: AppointmentPaymentMethod;
  paymentStatus: AppointmentPaymentStatus;
  hasReview: boolean;
  canReview: boolean;
  priceAmount?: number;
  address?: string;
  providerPhone?: string;
  prescriptionDocUrl?: string;
}

interface AppointmentDto {
  appointmentId: string;
  outletId: string;
  providerId?: string;
  serviceId: string;
  offeringId?: string;
  slotId: string;
  petId: string;
  providerName: string;
  serviceName: string;
  petName: string;
  startsAt: string;
  endsAt: string;
  status: 'HOLD' | 'BOOKED' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_SERVICE' | 'COMPLETED' | 'HOLD_EXPIRED' | 'REJECTED' | 'CANCELLED' | 'NO_SHOW';
  paymentMethod: AppointmentPaymentMethod;
  paymentStatus: AppointmentPaymentStatus;
  pricePaise: number | string;
  currency: string;
  notes?: string | null;
  holdExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

const CACHE_PREFIX = '@mypet_appointments_cache_v1_';
const HISTORY_PAGE_SIZE = 20;
const MAX_HISTORY_PAGES = 50;

function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function jsonHeaders(accessToken: string | null | undefined): Record<string, string> {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json' };
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; error?: string; message?: string } | null;
    const error = new Error(body?.message ?? body?.error ?? fallbackMessage);
    if (body?.code) error.name = body.code;
    throw error;
  }
  return (await response.json()) as T;
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const value = `${error.name} ${error.message}`.toLowerCase();
  return error instanceof TypeError || value.includes('network') || value.includes('offline') || value.includes('failed to fetch');
}

function mapStatus(status: AppointmentDto['status']): HistoryAppointmentStatus {
  switch (status) {
    case 'HOLD': return 'SLOT_HELD';
    case 'BOOKED': return 'PENDING_PROVIDER';
    case 'CONFIRMED':
    case 'CHECKED_IN':
    case 'IN_SERVICE': return 'CONFIRMED';
    case 'COMPLETED': return 'COMPLETED';
    case 'NO_SHOW': return 'NO_SHOW';
    case 'HOLD_EXPIRED': return 'EXPIRED';
    case 'REJECTED': return 'REJECTED';
    case 'CANCELLED': return 'CANCELLED';
  }
}

function mapAppointment(appointment: AppointmentDto): CustomerAppointmentRecord {
  const pricePaise = Number(appointment.pricePaise);
  return {
    id: appointment.appointmentId,
    providerName: appointment.providerName,
    providerId: appointment.providerId ?? appointment.outletId,
    serviceName: appointment.serviceName,
    offeringId: appointment.offeringId ?? appointment.serviceId,
    slotId: appointment.slotId,
    petName: appointment.petName,
    petId: appointment.petId,
    slotStartsAt: appointment.startsAt,
    slotEndsAt: appointment.endsAt,
    status: mapStatus(appointment.status),
    paymentMethod: appointment.paymentMethod,
    paymentStatus: appointment.paymentStatus,
    hasReview: false,
    canReview: false,
    priceAmount: Number.isFinite(pricePaise) ? pricePaise / 100 : undefined,
  };
}

async function fetchAppointmentPage(page: number, accessToken: string | null | undefined): Promise<PageResponse<AppointmentDto>> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/customer/appointments?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
    { headers: authHeaders(accessToken) },
  );
  const payload = await readJson<PageResponse<AppointmentDto>>(response, 'Could not load appointment history.');
  if (!Array.isArray(payload.items) || payload.page !== page || !Number.isInteger(payload.pageSize) || payload.pageSize <= 0) {
    const error = new Error('The appointment history response was invalid.');
    error.name = 'APPOINTMENT_HISTORY_RESPONSE_INVALID';
    throw error;
  }
  return payload;
}

export async function fetchCustomerAppointments(customerId: string, accessToken: string | null | undefined): Promise<CustomerAppointmentRecord[]> {
  const cacheKey = `${CACHE_PREFIX}${customerId}`;
  try {
    const unique = new Map<string, CustomerAppointmentRecord>();
    for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
      const payload = await fetchAppointmentPage(page, accessToken);
      for (const item of payload.items) {
        const mapped = mapAppointment(item);
        unique.set(mapped.id, mapped);
      }
      if (!payload.hasNext) {
        const result = [...unique.values()].sort((left, right) => right.slotStartsAt.localeCompare(left.slotStartsAt) || right.id.localeCompare(left.id));
        await AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => null);
        return result;
      }
    }
    const error = new Error('Appointment history exceeded the supported bounded pagination window.');
    error.name = 'APPOINTMENT_HISTORY_TOO_LARGE';
    throw error;
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached) {
      try { return JSON.parse(cached) as CustomerAppointmentRecord[]; }
      catch { await AsyncStorage.removeItem(cacheKey).catch(() => null); }
    }
    throw error;
  }
}

export async function fetchAppointmentDetails(appointmentId: string, accessToken: string | null | undefined): Promise<CustomerAppointmentRecord> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/customer/appointments/${encodeURIComponent(appointmentId)}`,
    { headers: authHeaders(accessToken) },
  );
  return mapAppointment(await readJson<AppointmentDto>(response, 'Could not load appointment details.'));
}

export async function cancelAppointment(appointmentId: string, reason: string, accessToken: string | null | undefined): Promise<void> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/customer/appointments/${encodeURIComponent(appointmentId)}/cancel`,
    { method: 'POST', headers: jsonHeaders(accessToken), body: JSON.stringify({ reason: reason.trim() || null }) },
  );
  await readJson<AppointmentDto>(response, 'Could not cancel appointment.');
}

export async function rescheduleAppointment(_appointmentId: string, _newSlotId: string, _accessToken: string | null | undefined): Promise<void> {
  throw new Error('Appointment rescheduling is not available in the current canonical booking contract.');
}

export async function submitAppointmentReview(_input: {
  customerId: string;
  providerId: string;
  targetId: string;
  rating: number;
  comment: string;
  accessToken: string | null | undefined;
}): Promise<'created' | 'duplicate'> {
  throw new Error('Appointment reviews are not available in the current canonical booking contract.');
}
