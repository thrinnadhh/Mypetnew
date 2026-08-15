import { getDemoAppointmentSlots } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';

const DEMO_USER_ID = 'd3b07384-d113-4e4e-9c8e-3d8e3d8e3d8e';
const AVAILABILITY_WINDOW_DAYS = 14;

export type AppointmentServiceCapability = 'GROOMING' | 'VETERINARY';

export interface AppointmentServiceOption {
  id: string;
  providerId: string;
  capability: AppointmentServiceCapability;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
}

export interface AppointmentSlotOption {
  id: string;
  providerId: string;
  offeringId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  startsAt?: string;
  endsAt?: string;
  price: number;
}

interface PublicServiceDto {
  serviceId: string;
  outletId: string;
  capability: AppointmentServiceCapability;
  name: string;
  description?: string | null;
  durationMinutes: number;
  pricePaise: number | string;
  currency: string;
}

interface PublicServiceSlotDto {
  slotId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
}

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

interface AppointmentResponse {
  appointmentId?: string;
  id?: string;
}

interface HoldAppointmentInput {
  slot: AppointmentSlotOption;
  userId: string | null | undefined;
  petId: string;
  accessToken: string | null | undefined;
}

function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function jsonHeaders(accessToken: string | null | undefined): Record<string, string> {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json' };
}

function resolveBookingUserId(userId: string | null | undefined): string {
  if (userId) return userId;
  if (appConfig.allowDemoMode) return DEMO_USER_ID;
  throw new Error('Please sign in before booking an appointment.');
}

function paiseToRupees(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function formatSlotTime(
  value: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return 'Slot time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Slot time unavailable';
  return date.toLocaleString('en-IN', options);
}

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: string; message?: string } | null;
  const error = new Error(body?.message ?? body?.error ?? fallback);
  if (body?.code) error.name = body.code;
  return error;
}

export async function fetchAppointmentServices(input: {
  providerId?: string;
  capability?: AppointmentServiceCapability;
} = {}): Promise<AppointmentServiceOption[]> {
  if (appConfig.allowDemoMode && input.providerId) {
    const slots = getDemoAppointmentSlots(input.providerId);
    const seen = new Set<string>();
    return slots.flatMap((slot) => {
      if (seen.has(slot.offeringId)) return [];
      seen.add(slot.offeringId);
      return [{
        id: slot.offeringId,
        providerId: slot.providerId,
        capability: input.capability ?? 'GROOMING',
        name: slot.serviceName,
        description: '',
        durationMinutes: 0,
        price: slot.price,
      }];
    });
  }

  const query = new URLSearchParams({ page: '0', pageSize: '100' });
  if (input.providerId) query.set('outletId', input.providerId);
  if (input.capability) query.set('capability', input.capability);

  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/public/services?${query.toString()}`, {
    headers: authHeaders(undefined),
  });
  if (!response.ok) throw await apiError(response, 'Could not load appointment services.');

  const payload = (await response.json()) as PageResponse<PublicServiceDto>;
  return payload.items.map((service) => ({
    id: service.serviceId,
    providerId: service.outletId,
    capability: service.capability,
    name: service.name,
    description: service.description?.trim() ?? '',
    durationMinutes: service.durationMinutes,
    price: paiseToRupees(service.pricePaise),
  }));
}

export async function fetchAvailableAppointmentSlots(
  providerId: string,
): Promise<AppointmentSlotOption[]> {
  if (appConfig.allowDemoMode) {
    return getDemoAppointmentSlots(providerId);
  }

  const services = await fetchAppointmentServices({ providerId });
  const from = new Date();
  const to = new Date(from.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const slotGroups = await Promise.all(
    services.map(async (service) => {
      const query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        page: '0',
        pageSize: '100',
      });
      const response = await fetch(
        `${appConfig.apiBaseUrl}/api/v1/public/services/${encodeURIComponent(service.id)}/availability?${query.toString()}`,
        { headers: authHeaders(undefined) },
      );
      if (!response.ok) return [];

      const payload = (await response.json()) as PageResponse<PublicServiceSlotDto>;
      return payload.items.map((slot): AppointmentSlotOption => ({
        id: slot.slotId,
        providerId: service.providerId,
        offeringId: service.id,
        serviceName: service.name,
        startTime: formatSlotTime(slot.startsAt, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
        endTime: formatSlotTime(slot.endsAt, {
          hour: '2-digit',
          minute: '2-digit',
        }),
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        price: service.price,
      }));
    }),
  );

  return slotGroups.flat().sort((left, right) => (left.startsAt ?? '').localeCompare(right.startsAt ?? ''));
}

export async function holdAppointmentSlot(input: HoldAppointmentInput): Promise<string> {
  resolveBookingUserId(input.userId);
  if (!input.petId) throw new Error('Select a pet before booking.');
  if (!input.accessToken && !appConfig.allowDemoMode) throw new Error('Please sign in before booking an appointment.');

  if (appConfig.allowDemoMode && input.slot.id.startsWith('demo-slot-')) {
    return `demo-appointment-${input.slot.id}`;
  }

  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/customer/appointments`, {
    method: 'POST',
    headers: {
      ...jsonHeaders(input.accessToken),
      'Idempotency-Key': `appointment-${input.slot.id}-${input.petId}`,
    },
    body: JSON.stringify({
      outletId: input.slot.providerId,
      serviceId: input.slot.offeringId,
      slotId: input.slot.id,
      petId: input.petId,
      paymentMethod: 'PAY_AT_PROVIDER',
    }),
  });

  if (!response.ok) {
    throw await apiError(response, 'This slot was just taken. Please choose another.');
  }

  const data = (await response.json()) as AppointmentResponse;
  const appointmentId = data.appointmentId ?? data.id;
  if (!appointmentId) {
    throw new Error('Appointment hold succeeded but no appointment ID was returned.');
  }
  return appointmentId;
}

export async function confirmAppointmentHold(
  appointmentId: string,
  accessToken: string | null | undefined,
): Promise<void> {
  if (appConfig.allowDemoMode && appointmentId.startsWith('demo-appointment-')) return;
  if (!accessToken) throw new Error('Please sign in before confirming an appointment.');

  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/customer/appointments/${encodeURIComponent(appointmentId)}/confirm`,
    { method: 'POST', headers: authHeaders(accessToken) },
  );

  if (!response.ok) {
    throw await apiError(response, 'The appointment was not confirmed. Please retry.');
  }
}
