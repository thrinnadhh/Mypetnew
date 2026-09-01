import { merchantApiFetch } from '../auth/session';

export type MerchantAppointmentStatus =
  | 'HOLD'
  | 'BOOKED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'HOLD_EXPIRED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type MerchantAppointmentPaymentMethod = 'PAY_AT_PROVIDER' | 'ONLINE_PAYMENT';

export type MerchantAppointmentPaymentStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED';

export type MerchantAppointmentRequest = {
  appointmentId: string;
  outletId: string;
  serviceId: string;
  slotId: string;
  petName: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: MerchantAppointmentStatus;
  paymentMethod: MerchantAppointmentPaymentMethod;
  paymentStatus: MerchantAppointmentPaymentStatus;
  pricePaise: number;
  currency: 'INR';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MerchantAppointmentPage = {
  items: MerchantAppointmentRequest[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export type FetchMerchantAppointmentsOptions = {
  outletId?: string;
  status?: MerchantAppointmentStatus;
  page?: number;
  pageSize?: number;
};

async function serverError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string; error?: string } | null;
  const error = new Error(body?.message ?? body?.error ?? fallback);
  if (body?.code) error.name = body.code;
  return error;
}

export function appointmentTargets(appointment: MerchantAppointmentRequest): MerchantAppointmentStatus[] {
  switch (appointment.status) {
    case 'BOOKED':
      return ['CONFIRMED', 'REJECTED', 'CANCELLED', 'NO_SHOW'];
    case 'CONFIRMED':
      return ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'];
    case 'CHECKED_IN':
      return ['IN_SERVICE'];
    case 'IN_SERVICE':
      return ['COMPLETED'];
    default:
      return [];
  }
}

export async function fetchMerchantAppointments(
  options?: FetchMerchantAppointmentsOptions,
): Promise<MerchantAppointmentPage> {
  const params = new URLSearchParams({
    page: String(options?.page ?? 0),
    pageSize: String(options?.pageSize ?? 50),
  });
  if (options?.status) {
    params.set('status', options.status);
  }
  if (options?.outletId) {
    params.set('outletId', options.outletId);
  }
  const response = await merchantApiFetch(`/api/v1/merchant/appointments?${params.toString()}`);
  if (!response.ok) throw await serverError(response, 'Could not load appointments.');
  return (await response.json()) as MerchantAppointmentPage;
}

export async function fetchMerchantAppointment(appointmentId: string): Promise<MerchantAppointmentRequest> {
  const response = await merchantApiFetch(`/api/v1/merchant/appointments/${encodeURIComponent(appointmentId)}`);
  if (!response.ok) throw await serverError(response, 'Could not load appointment.');
  return (await response.json()) as MerchantAppointmentRequest;
}

export async function fetchPendingAppointmentRequests(): Promise<MerchantAppointmentRequest[]> {
  const page = await fetchMerchantAppointments({ status: 'BOOKED', pageSize: 100 });
  return page.items;
}

export async function transitionMerchantAppointment(
  appointment: MerchantAppointmentRequest,
  target: MerchantAppointmentStatus,
): Promise<MerchantAppointmentRequest> {
  const allowed = appointmentTargets(appointment);
  if (!allowed.includes(target)) {
    const error = new Error('APPOINTMENT_TRANSITION_INVALID');
    error.name = 'APPOINTMENT_STATE_INVALID';
    throw error;
  }
  const response = await merchantApiFetch(
    `/api/v1/merchant/appointments/${encodeURIComponent(appointment.appointmentId)}/status`,
    {
      method: 'POST',
      body: JSON.stringify({ outletId: appointment.outletId, status: target }),
    },
  );
  if (!response.ok) {
    throw await serverError(
      response,
      target === 'CONFIRMED'
        ? 'Could not accept this booking request.'
        : target === 'REJECTED'
          ? 'Could not reject this booking request.'
          : `Could not transition appointment to ${target}.`,
    );
  }
  return (await response.json()) as MerchantAppointmentRequest;
}

export async function decideAppointmentRequest(
  request: MerchantAppointmentRequest,
  decision: 'CONFIRMED' | 'REJECTED',
): Promise<MerchantAppointmentRequest> {
  return transitionMerchantAppointment(request, decision);
}
