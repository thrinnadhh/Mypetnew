import { captainApiFetch, handleApiResponse } from './client';

export interface CaptainDeliveryStateResponse {
  captainId: string;
  approved: boolean;
  online: boolean;
  busy: boolean;
  lastLocationAt?: string | null;
}

export interface CaptainAvailabilityParams {
  online: boolean;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  capturedAt?: string | null;
  heading?: number | null;
  speed?: number | null;
}

export type CaptainLocationParams = Omit<CaptainAvailabilityParams, 'online'>;

export async function updateCaptainAvailability(
  params: CaptainAvailabilityParams,
  idempotencyKey?: string,
): Promise<CaptainDeliveryStateResponse> {
  const response = await captainApiFetch('/api/v1/captain/availability', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      online: params.online,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      accuracy: params.accuracy ?? null,
      capturedAt: params.capturedAt ?? null,
      heading: params.heading ?? null,
      speed: params.speed ?? null,
    }),
    idempotencyKey,
    timeoutMs: 8000,
  });

  return await handleApiResponse<CaptainDeliveryStateResponse>(response);
}

export async function publishCaptainLocation(
  params: CaptainLocationParams,
): Promise<CaptainDeliveryStateResponse> {
  const response = await captainApiFetch('/api/v1/captain/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      accuracy: params.accuracy ?? null,
      capturedAt: params.capturedAt ?? null,
      heading: params.heading ?? null,
      speed: params.speed ?? null,
    }),
    timeoutMs: 8000,
  });

  return await handleApiResponse<CaptainDeliveryStateResponse>(response);
}
