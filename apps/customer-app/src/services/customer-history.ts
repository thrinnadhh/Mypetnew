import AsyncStorage from '@react-native-async-storage/async-storage';
import { appConfig } from '@/utils/app-config';

export type HistoryAppointmentStatus = 'SLOT_HELD' | 'PAID' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';
export type AppointmentTabCategory = 'upcoming' | 'past' | 'cancelled';

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
  status: HistoryAppointmentStatus;
  hasReview: boolean;
  priceAmount?: number;
  address?: string;
  providerPhone?: string;
  prescriptionDocUrl?: string;
}

interface AppointmentDto {
  appointmentId?: string;
  id?: string;
  customerId: string;
  providerId: string;
  offeringId: string;
  slotId: string;
  petId: string;
  status: HistoryAppointmentStatus;
  bookedAt?: string;
  priceAmount?: number | string;
  prescriptionDocUrl?: string;
}

interface ProviderDto {
  providerId: string;
  name: string;
  address?: string;
  phone?: string;
}

interface OfferingDto {
  offeringId: string;
  name: string;
}

interface SlotDto {
  slotStart?: string;
  startTime?: string;
}

interface ReviewDto {
  id: string;
  targetType: 'APPOINTMENT' | 'ORDER' | 'PROVIDER';
  targetId: string;
}

const CACHE_PREFIX = '@mypet_appointments_cache_v1_';

function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function jsonHeaders(accessToken: string | null | undefined): Record<string, string> {
  return {
    ...authHeaders(accessToken),
    'Content-Type': 'application/json',
  };
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(body?.error ?? body?.message ?? fallbackMessage);
  }
  return (await response.json()) as T;
}

async function fetchProviderDetails(providerId: string, accessToken: string | null | undefined): Promise<ProviderDto> {
  try {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/providers/${providerId}`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return { providerId, name: `Provider ${providerId.slice(0, 8)}` };
    return (await response.json()) as ProviderDto;
  } catch {
    return { providerId, name: `Provider ${providerId.slice(0, 8)}` };
  }
}

async function fetchOfferingName(providerId: string, offeringId: string, accessToken: string | null | undefined): Promise<string> {
  try {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/catalog/offerings?providerId=${providerId}`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return `Service ${offeringId.slice(0, 8)}`;
    const offerings = (await response.json()) as OfferingDto[];
    return offerings.find((offering) => offering.offeringId === offeringId)?.name ?? `Service ${offeringId.slice(0, 8)}`;
  } catch {
    return `Service ${offeringId.slice(0, 8)}`;
  }
}

async function fetchSlotStart(slotId: string, accessToken: string | null | undefined): Promise<string | null> {
  try {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/catalog/slots/${slotId}`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return null;
    const slot = (await response.json()) as SlotDto;
    return slot.slotStart ?? slot.startTime ?? null;
  } catch {
    return null;
  }
}

export async function fetchCustomerAppointments(
  customerId: string,
  accessToken: string | null | undefined,
): Promise<CustomerAppointmentRecord[]> {
  const cacheKey = `${CACHE_PREFIX}${customerId}`;

  try {
    const [appointmentsResponse, reviewsResponse] = await Promise.all([
      fetch(`${appConfig.apiBaseUrl}/api/v1/appointments/customer/${customerId}`, {
        headers: authHeaders(accessToken),
      }),
      fetch(`${appConfig.apiBaseUrl}/api/v1/reviews/customer/${customerId}`, {
        headers: authHeaders(accessToken),
      }),
    ]);

    const appointments = await readJson<AppointmentDto[]>(appointmentsResponse, 'Could not load appointment history.');
    const reviews = reviewsResponse.ok ? ((await reviewsResponse.json()) as ReviewDto[]) : [];
    const reviewedAppointmentIds = new Set(
      reviews.filter((review) => review.targetType === 'APPOINTMENT').map((review) => review.targetId),
    );

    const enriched = await Promise.all(
      appointments.map(async (appointment): Promise<CustomerAppointmentRecord> => {
        const id = appointment.appointmentId ?? appointment.id;
        if (!id) throw new Error('Appointment response did not include an appointment ID.');
        const [provider, serviceName, slotStart] = await Promise.all([
          fetchProviderDetails(appointment.providerId, accessToken),
          fetchOfferingName(appointment.providerId, appointment.offeringId, accessToken),
          fetchSlotStart(appointment.slotId, accessToken),
        ]);

        return {
          id,
          providerName: provider.name,
          providerId: appointment.providerId,
          serviceName,
          offeringId: appointment.offeringId,
          slotId: appointment.slotId,
          petName: `Pet ${appointment.petId.slice(0, 8)}`,
          petId: appointment.petId,
          slotStartsAt: slotStart ?? appointment.bookedAt ?? new Date().toISOString(),
          status: appointment.status,
          hasReview: reviewedAppointmentIds.has(id),
          priceAmount: Number(appointment.priceAmount) || undefined,
          address: provider.address,
          providerPhone: provider.phone,
          prescriptionDocUrl: appointment.prescriptionDocUrl,
        };
      }),
    );

    const result = enriched.sort((left, right) => right.slotStartsAt.localeCompare(left.slotStartsAt));
    await AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => null);
    return result;
  } catch (error) {
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as CustomerAppointmentRecord[];
      } catch {
        // Fall through
      }
    }
    throw error;
  }
}

export async function fetchAppointmentDetails(
  appointmentId: string,
  accessToken: string | null | undefined,
): Promise<CustomerAppointmentRecord> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/appointments/${appointmentId}`, {
    headers: authHeaders(accessToken),
  });
  const appt = await readJson<AppointmentDto>(response, 'Could not load appointment details.');
  const id = appt.appointmentId ?? appt.id ?? appointmentId;

  const [provider, serviceName, slotStart] = await Promise.all([
    fetchProviderDetails(appt.providerId, accessToken),
    fetchOfferingName(appt.providerId, appt.offeringId, accessToken),
    fetchSlotStart(appt.slotId, accessToken),
  ]);

  return {
    id,
    providerName: provider.name,
    providerId: appt.providerId,
    serviceName,
    offeringId: appt.offeringId,
    slotId: appt.slotId,
    petName: `Pet ${appt.petId.slice(0, 8)}`,
    petId: appt.petId,
    slotStartsAt: slotStart ?? appt.bookedAt ?? new Date().toISOString(),
    status: appt.status,
    hasReview: false,
    priceAmount: Number(appt.priceAmount) || undefined,
    address: provider.address,
    providerPhone: provider.phone,
    prescriptionDocUrl: appt.prescriptionDocUrl,
  };
}

export async function cancelAppointment(
  appointmentId: string,
  reason: string,
  accessToken: string | null | undefined,
): Promise<void> {
  const url = `${appConfig.apiBaseUrl}/api/v1/appointments/${appointmentId}/status?status=CANCELLED&note=${encodeURIComponent(reason)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: authHeaders(accessToken),
  });
  await readJson<unknown>(response, 'Could not cancel appointment.');
}

export async function rescheduleAppointment(
  appointmentId: string,
  newSlotId: string,
  accessToken: string | null | undefined,
): Promise<void> {
  const url = `${appConfig.apiBaseUrl}/api/v1/appointments/${appointmentId}/reschedule?newSlotId=${newSlotId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  await readJson<unknown>(response, 'Could not reschedule appointment.');
}

export async function submitAppointmentReview(input: {
  customerId: string;
  providerId: string;
  targetId: string;
  rating: number;
  comment: string;
  accessToken: string | null | undefined;
}): Promise<'created' | 'duplicate'> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/reviews`, {
    method: 'POST',
    headers: jsonHeaders(input.accessToken),
    body: JSON.stringify({
      customerId: input.customerId,
      providerId: input.providerId,
      targetType: 'APPOINTMENT',
      targetId: input.targetId,
      rating: input.rating,
      comment: input.comment.trim() || null,
    }),
  });

  if (response.status === 409) return 'duplicate';
  await readJson<unknown>(response, 'Could not submit review.');
  return 'created';
}
