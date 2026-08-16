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
  paymentMethod: 'PAY_AT_PROVIDER' | 'ONLINE_PAYMENT';
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
  pricePaise: number;
  currency: 'INR';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PageResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

async function serverError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string; error?: string } | null;
  const error = new Error(body?.message ?? body?.error ?? fallback);
  if (body?.code) error.name = body.code;
  return error;
}

export async function fetchPendingAppointmentRequests(): Promise<MerchantAppointmentRequest[]> {
  const response = await merchantApiFetch('/api/v1/merchant/appointments?status=BOOKED&page=0&pageSize=100');
  if (!response.ok) throw await serverError(response, 'Could not load booking requests.');
  const page = (await response.json()) as PageResponse<MerchantAppointmentRequest>;
  return page.items;
}

export async function decideAppointmentRequest(
  request: MerchantAppointmentRequest,
  decision: 'CONFIRMED' | 'REJECTED',
): Promise<MerchantAppointmentRequest> {
  const response = await merchantApiFetch(
    `/api/v1/merchant/appointments/${encodeURIComponent(request.appointmentId)}/status`,
    {
      method: 'POST',
      body: JSON.stringify({ outletId: request.outletId, status: decision }),
    },
  );
  if (!response.ok) {
    throw await serverError(
      response,
      decision === 'CONFIRMED' ? 'Could not accept this booking request.' : 'Could not reject this booking request.',
    );
  }
  return (await response.json()) as MerchantAppointmentRequest;
}
