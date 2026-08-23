import { CaptainProfile } from '../domain/captain';
import { captainApiFetch, handleApiResponse } from './client';

export async function fetchCaptainProfile(): Promise<CaptainProfile> {
  const response = await captainApiFetch('/api/v1/captain/me', { timeoutMs: 8000 });
  return await handleApiResponse<CaptainProfile>(response);
}
