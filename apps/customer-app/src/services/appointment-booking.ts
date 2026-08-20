import { getDemoAppointmentSlots } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';
import { isUuid } from '@/utils/uuid';

const DEMO_USER_ID = 'd3b07384-d113-4e4e-9c8e-3d8e3d8e3d8e';
const AVAILABILITY_WINDOW_DAYS = 14;
const PUBLIC_PAGE_SIZE = 100;
const MAX_PUBLIC_PAGES = 10;
const TERMINAL_REPLAY_STATUSES = new Set(['CANCELLED', 'HOLD_EXPIRED', 'REJECTED']);
const PIN_PATTERN = /^[1-9][0-9]{5}$/;

export const APPOINTMENT_DISPLAY_TIME_ZONE = 'Asia/Kolkata';

export type AppointmentServiceCapability = 'GROOMING' | 'VETERINARY';
export type AppointmentPaymentMethod = 'PAY_AT_PROVIDER' | 'ONLINE_PAYMENT';

export interface AppointmentServiceOption {
  id: string;
  providerId: string;
  capability: AppointmentServiceCapability;
  name: string;
  description: string;
  durationMinutes: number;
  /** Compatibility projection for released appointment surfaces. Transaction authority remains pricePaise on the server. */
  price: number;
  pricePaise: number;
  currency: string;
}

export interface AppointmentSlotOption {
  id: string;
  providerId: string;
  offeringId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  /** Canonical backend Instant strings. Never rewrite these for handoff or booking authority. */
  startsAt?: string;
  endsAt?: string;
  /** Compatibility projection for released appointment surfaces. */
  price: number;
  pricePaise?: number;
  currency?: string;
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
  status?: string;
}

export interface HoldAppointmentInput {
  slot: AppointmentSlotOption;
  userId: string | null | undefined;
  petId: string;
  pincode: string;
  /** Older callers remain Pay-at-Provider unless they explicitly opt into Cashfree. */
  paymentMethod?: AppointmentPaymentMethod;
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

function contractError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

function parsePricePaise(value: number | string): number {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw contractError('SERVICE_PRICE_INVALID', 'The provider returned an invalid service price.');
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000_000) {
    throw contractError('SERVICE_PRICE_INVALID', 'The provider returned an invalid service price.');
  }
  return parsed;
}

function paiseToRupees(value: number): number {
  return value / 100;
}

function requireCurrency(value: string): string {
  const normalized = value?.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw contractError('SERVICE_CURRENCY_INVALID', 'The provider returned an invalid service currency.');
  }
  return normalized;
}

function formatSlotTime(value: string | undefined, options: Intl.DateTimeFormatOptions): string {
  if (!value) return 'Slot time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Slot time unavailable';
  return date.toLocaleString('en-IN', { ...options, timeZone: APPOINTMENT_DISPLAY_TIME_ZONE });
}

function appointmentAttemptKey(
  slotId: string,
  petId: string,
  pincode: string,
  paymentMethod: AppointmentPaymentMethod,
): string {
  const baseKey = `appointment-v2-${slotId}-${petId}-${pincode}`;
  return paymentMethod === 'PAY_AT_PROVIDER' ? baseKey : `${baseKey}-ONLINE_PAYMENT`;
}

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: string; message?: string } | null;
  const error = new Error(body?.message ?? body?.error ?? fallback);
  if (body?.code) error.name = body.code;
  return error;
}

function validateService(
  dto: PublicServiceDto,
  expectedProviderId?: string,
  expectedCapability?: AppointmentServiceCapability,
  strictIdentity = true,
): AppointmentServiceOption {
  if (strictIdentity && (!isUuid(dto.serviceId) || !isUuid(dto.outletId))) {
    throw contractError('SERVICE_IDENTITY_INVALID', 'The provider returned an invalid service identity.');
  }
  if (strictIdentity && expectedProviderId && dto.outletId !== expectedProviderId) {
    throw contractError('SERVICE_PROVIDER_MISMATCH', 'A service was returned for a different provider.');
  }
  if (expectedCapability && dto.capability !== expectedCapability) {
    throw contractError('SERVICE_CAPABILITY_MISMATCH', 'A service was returned for the wrong capability.');
  }
  if (dto.capability !== 'GROOMING' && dto.capability !== 'VETERINARY') {
    throw contractError('SERVICE_CAPABILITY_INVALID', 'The provider returned an invalid service capability.');
  }
  const name = dto.name?.trim() ?? '';
  if (name.length < 2 || name.length > 160) {
    throw contractError('SERVICE_NAME_INVALID', 'The provider returned an invalid service name.');
  }
  if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 5 || dto.durationMinutes > 480) {
    throw contractError('SERVICE_DURATION_INVALID', 'The provider returned an invalid service duration.');
  }
  const pricePaise = parsePricePaise(dto.pricePaise);
  const currency = requireCurrency(dto.currency);
  const description = dto.description?.trim() ?? '';
  if (description.length > 1_000) {
    throw contractError('SERVICE_DESCRIPTION_INVALID', 'The provider returned an invalid service description.');
  }
  return {
    id: dto.serviceId,
    providerId: dto.outletId,
    capability: dto.capability,
    name,
    description,
    durationMinutes: dto.durationMinutes,
    price: paiseToRupees(pricePaise),
    pricePaise,
    currency,
  };
}

function sameService(left: AppointmentServiceOption, right: AppointmentServiceOption): boolean {
  return left.providerId === right.providerId
    && left.capability === right.capability
    && left.name === right.name
    && left.description === right.description
    && left.durationMinutes === right.durationMinutes
    && left.pricePaise === right.pricePaise
    && left.currency === right.currency;
}

async function fetchServicePage(
  input: { providerId?: string; capability?: AppointmentServiceCapability },
  page: number,
): Promise<PageResponse<PublicServiceDto>> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(PUBLIC_PAGE_SIZE) });
  if (input.providerId) query.set('outletId', input.providerId);
  if (input.capability) query.set('capability', input.capability);
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/public/services?${query.toString()}`, {
    headers: authHeaders(undefined),
  });
  if (!response.ok) throw await apiError(response, 'Could not load appointment services.');
  return (await response.json()) as PageResponse<PublicServiceDto>;
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
      const pricePaise = Math.round(slot.price * 100);
      return [{
        id: slot.offeringId,
        providerId: slot.providerId,
        capability: input.capability ?? 'GROOMING',
        name: slot.serviceName,
        description: '',
        durationMinutes: 30,
        price: slot.price,
        pricePaise,
        currency: 'INR',
      }];
    });
  }

  // P10/P11 production surfaces always provide an explicit capability and use
  // canonical UUID route context. The unscoped form is retained for older
  // generic appointment callers whose opaque fixture IDs are intentionally not
  // route/domain authority.
  const strictContract = Boolean(input.capability);
  if (strictContract && input.providerId && !isUuid(input.providerId)) {
    throw contractError('PROVIDER_ID_INVALID', 'A valid provider is required to load services.');
  }

  const unique = new Map<string, AppointmentServiceOption>();
  for (let page = 0; page < MAX_PUBLIC_PAGES; page += 1) {
    const payload = await fetchServicePage(input, page);
    if (!Array.isArray(payload.items)) {
      throw contractError('SERVICE_RESPONSE_INVALID', 'The provider returned an invalid service catalogue.');
    }
    for (const dto of payload.items) {
      const mapped = validateService(dto, input.providerId, input.capability, strictContract);
      const existing = unique.get(mapped.id);
      if (existing && !sameService(existing, mapped)) {
        throw contractError('SERVICE_DUPLICATE_CONFLICT', 'Conflicting copies of a service were returned.');
      }
      unique.set(mapped.id, existing ?? mapped);
    }
    if (!payload.hasNext) return [...unique.values()];
  }
  throw contractError('SERVICE_CATALOG_TOO_LARGE', 'The service catalogue exceeded the supported bounded result window.');
}

function validateSlot(
  dto: PublicServiceSlotDto,
  service: AppointmentServiceOption,
  nowMs: number,
  strictContract: boolean,
): AppointmentSlotOption | null {
  if (strictContract && (!isUuid(dto.slotId) || !isUuid(dto.serviceId))) {
    throw contractError('SLOT_IDENTITY_INVALID', 'The provider returned an invalid slot identity.');
  }
  if (dto.serviceId !== service.id) {
    throw contractError('SLOT_SERVICE_MISMATCH', 'A slot was returned for a different service.');
  }
  const startsAtMs = Date.parse(dto.startsAt);
  const endsAtMs = Date.parse(dto.endsAt);
  const hasValidTimes = Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs) && endsAtMs > startsAtMs;
  if (!hasValidTimes && strictContract) {
    throw contractError('SLOT_TIME_INVALID', 'The provider returned an invalid appointment time.');
  }
  if (hasValidTimes && startsAtMs <= nowMs) return null;
  return {
    id: dto.slotId,
    providerId: service.providerId,
    offeringId: service.id,
    serviceName: service.name,
    startTime: formatSlotTime(dto.startsAt, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }),
    endTime: formatSlotTime(dto.endsAt, { hour: '2-digit', minute: '2-digit' }),
    startsAt: dto.startsAt,
    endsAt: dto.endsAt,
    price: service.price,
    pricePaise: service.pricePaise,
    currency: service.currency,
  };
}

function sameSlot(left: AppointmentSlotOption, right: AppointmentSlotOption): boolean {
  return left.providerId === right.providerId
    && left.offeringId === right.offeringId
    && left.startsAt === right.startsAt
    && left.endsAt === right.endsAt;
}

async function fetchSlotsForService(
  service: AppointmentServiceOption,
  from: Date,
  to: Date,
  nowMs: number,
  strictContract: boolean,
): Promise<AppointmentSlotOption[]> {
  const unique = new Map<string, AppointmentSlotOption>();
  for (let page = 0; page < MAX_PUBLIC_PAGES; page += 1) {
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      page: String(page),
      pageSize: String(PUBLIC_PAGE_SIZE),
    });
    const response = await fetch(
      `${appConfig.apiBaseUrl}/api/v1/public/services/${encodeURIComponent(service.id)}/availability?${query.toString()}`,
      { headers: authHeaders(undefined) },
    );
    if (!response.ok) throw await apiError(response, 'Could not load appointment availability.');
    const payload = (await response.json()) as PageResponse<PublicServiceSlotDto>;
    if (!Array.isArray(payload.items)) {
      throw contractError('SLOT_RESPONSE_INVALID', 'The provider returned an invalid availability response.');
    }
    for (const dto of payload.items) {
      const mapped = validateSlot(dto, service, nowMs, strictContract);
      if (!mapped) continue;
      const existing = unique.get(mapped.id);
      if (existing && !sameSlot(existing, mapped)) {
        throw contractError('SLOT_DUPLICATE_CONFLICT', 'Conflicting copies of a slot were returned.');
      }
      unique.set(mapped.id, existing ?? mapped);
    }
    if (!payload.hasNext) return [...unique.values()];
  }
  throw contractError('SLOT_CATALOG_TOO_LARGE', 'Appointment availability exceeded the supported bounded result window.');
}

export async function fetchAvailableAppointmentSlots(
  providerId: string,
  serviceId?: string,
  capability?: AppointmentServiceCapability,
): Promise<AppointmentSlotOption[]> {
  if (appConfig.allowDemoMode) {
    return getDemoAppointmentSlots(providerId)
      .filter((slot) => !serviceId || slot.offeringId === serviceId)
      .map((slot) => ({
        ...slot,
        pricePaise: Math.round(slot.price * 100),
        currency: 'INR',
      }));
  }

  const strictContract = Boolean(capability);
  if (strictContract && !isUuid(providerId)) {
    throw contractError('PROVIDER_ID_INVALID', 'A valid provider is required to load appointment availability.');
  }
  if (strictContract && serviceId && !isUuid(serviceId)) {
    throw contractError('SERVICE_ID_INVALID', 'A valid service is required to load appointment availability.');
  }

  const discovered = await fetchAppointmentServices({ providerId, capability });
  const services = serviceId ? discovered.filter((service) => service.id === serviceId) : discovered;
  if (serviceId && services.length === 0) {
    throw contractError('SERVICE_NOT_AVAILABLE', 'This service is no longer published by the selected provider.');
  }

  const nowMs = Date.now();
  const from = new Date(nowMs);
  const to = new Date(nowMs + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const slots: AppointmentSlotOption[] = [];
  for (const service of services) {
    slots.push(...await fetchSlotsForService(service, from, to, nowMs, strictContract));
  }
  return slots.sort((left, right) => (left.startsAt ?? '').localeCompare(right.startsAt ?? ''));
}

async function createAppointmentHold(
  input: HoldAppointmentInput,
  paymentMethod: AppointmentPaymentMethod,
  idempotencyKey: string,
): Promise<AppointmentResponse> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/customer/appointments`, {
    method: 'POST',
    headers: { ...jsonHeaders(input.accessToken), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      outletId: input.slot.providerId,
      serviceId: input.slot.offeringId,
      slotId: input.slot.id,
      slotStartsAt: input.slot.startsAt,
      slotEndsAt: input.slot.endsAt,
      petId: input.petId,
      pincode: input.pincode,
      paymentMethod,
    }),
  });

  if (!response.ok) throw await apiError(response, 'This slot was just taken. Please choose another.');
  return (await response.json()) as AppointmentResponse;
}

export async function holdAppointmentSlot(input: HoldAppointmentInput): Promise<string> {
  resolveBookingUserId(input.userId);
  if (!input.petId) throw new Error('Select a pet before booking.');
  if (!PIN_PATTERN.test(input.pincode)) throw contractError('PIN_CODE_INVALID', 'Select a valid six-digit service PIN before booking.');
  if (!input.accessToken && !appConfig.allowDemoMode) throw new Error('Please sign in before booking an appointment.');
  if (appConfig.allowDemoMode && input.slot.id.startsWith('demo-slot-')) return `demo-appointment-${input.slot.id}`;
  if (!input.slot.startsAt || !input.slot.endsAt) {
    throw contractError('SLOT_TIME_INVALID', 'Reload appointment availability before booking this slot.');
  }

  const paymentMethod = input.paymentMethod ?? 'PAY_AT_PROVIDER';
  const baseKey = appointmentAttemptKey(input.slot.id, input.petId, input.pincode, paymentMethod);
  let data = await createAppointmentHold(input, paymentMethod, baseKey);
  if (data.status && TERMINAL_REPLAY_STATUSES.has(data.status)) {
    data = await createAppointmentHold(input, paymentMethod, `${baseKey}-retry-${Date.now().toString(36)}`);
  }

  const appointmentId = data.appointmentId ?? data.id;
  if (!appointmentId) throw new Error('Appointment hold succeeded but no appointment ID was returned.');
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
  if (!response.ok) throw await apiError(response, 'The appointment was not confirmed. Please retry.');
}
