import { CaptainEarningsSummary } from '../domain/earnings';
import { captainApiFetch, handleApiResponse } from './client';

export async function fetchCaptainEarnings(): Promise<CaptainEarningsSummary> {
  const response = await captainApiFetch('/api/v1/captain/earnings', { timeoutMs: 8000 });
  return await handleApiResponse<CaptainEarningsSummary>(response);
}
