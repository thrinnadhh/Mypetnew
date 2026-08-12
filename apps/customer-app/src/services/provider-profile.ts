import { appConfig } from '@/utils/app-config';

export interface ProviderProfile {
  providerId: string;
  providerType: string;
  fulfillmentType: string;
  name: string;
  description: string | null;
  city: string;
  ratingAvg: number;
  ratingCount: number;
  status: string;
}
interface ProviderProfileDto extends Omit<ProviderProfile, 'ratingAvg'> { ratingAvg: number | string }

export async function fetchProviderProfile(providerId: string): Promise<ProviderProfile> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/providers/${encodeURIComponent(providerId)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`PROVIDER_PROFILE_${response.status}`);
  const value = await response.json() as ProviderProfileDto;
  return { ...value, ratingAvg: Number(value.ratingAvg ?? 0), ratingCount: Number(value.ratingCount ?? 0) };
}
