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
}

export async function updateCaptainAvailability(
  params: CaptainAvailabilityParams,
): Promise<CaptainDeliveryStateResponse> {
  try {
    const response = await captainApiFetch('/api/v1/captain/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        online: params.online,
        latitude: params.latitude ?? null,
        longitude: params.longitude ?? null,
      }),
      timeoutMs: 4000,
    });

    return await handleApiResponse<CaptainDeliveryStateResponse>(response);
  } catch (err: any) {
    if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT_ERROR') {
      return {
        captainId: 'captain-sandbox-01',
        approved: true,
        online: params.online,
        busy: false,
        lastLocationAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}
