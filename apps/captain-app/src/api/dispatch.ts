import { captainApiFetch, handleApiResponse } from './client';

export interface CaptainOfferProjection {
  offerId: string;
  jobId: string;
  expiresAt: string;
  outletName?: string;
  area?: string;
  distanceMeters?: number;
  itemCount?: number;
  estimatedEarningPaise?: number;
}

export interface CaptainDeliveryAddressProjection {
  addressId: string;
  recipientName: string;
  phoneNumber: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface CaptainAssignmentProjection {
  accepted: boolean;
  jobId?: string | null;
  orderId?: string | null;
  outletId?: string | null;
  outletName?: string | null;
  deliveryAddress?: CaptainDeliveryAddressProjection | null;
}

export type DispatchStatus =
  | 'SEARCHING'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'FAILED';

export interface DispatchJobResponse {
  id?: string;
  jobId?: string;
  orderId: string;
  outletId: string;
  originLatitude?: number;
  originLongitude?: number;
  status: DispatchStatus;
  assignedCaptainId?: string | null;
  attemptCount?: number;
  failureReason?: string | null;
  assignedAt?: string | null;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export async function fetchDispatchJob(jobId: string): Promise<DispatchJobResponse> {
  const response = await captainApiFetch(`/api/v1/captain/dispatch/${jobId}`, { timeoutMs: 8000 });
  const data = await handleApiResponse<DispatchJobResponse>(response);
  return {
    ...data,
    id: data.id || data.jobId || jobId,
    jobId: data.jobId || data.id || jobId,
  };
}

export async function fetchPendingOffers(): Promise<CaptainOfferProjection[]> {
  const response = await captainApiFetch('/api/v1/captain/dispatch/offers', { timeoutMs: 8000 });
  return await handleApiResponse<CaptainOfferProjection[]>(response);
}

export async function respondToOffer(
  offerId: string,
  action: 'ACCEPT' | 'REJECT',
  idempotencyKey?: string,
): Promise<CaptainAssignmentProjection> {
  const response = await captainApiFetch(`/api/v1/captain/dispatch/offers/${offerId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    idempotencyKey,
    timeoutMs: 8000,
  });

  return await handleApiResponse<CaptainAssignmentProjection>(response);
}

export async function markJobPickedUp(
  jobId: string,
  idempotencyKey: string,
): Promise<DispatchJobResponse> {
  const response = await captainApiFetch(`/api/v1/captain/dispatch/${jobId}/picked-up`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    idempotencyKey,
    timeoutMs: 8000,
  });

  return await handleApiResponse<DispatchJobResponse>(response);
}

export async function markJobDelivered(
  jobId: string,
  idempotencyKey: string,
): Promise<DispatchJobResponse> {
  const response = await captainApiFetch(`/api/v1/captain/dispatch/${jobId}/delivered`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    idempotencyKey,
    timeoutMs: 8000,
  });

  return await handleApiResponse<DispatchJobResponse>(response);
}
