import type { LaunchMarket } from '@/config/markets';
import { DEMO_PROVIDER_FIXTURES } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';

export type DiscoverableProviderType = 'VET_HOSPITAL' | 'GROOMER' | 'PET_STORE';
export interface ProviderSummary {
  id: string;
  name: string;
  description: string;
  distanceKm: number;
  rating: number;
  ratingCount: number;
}
interface ProviderDto {
  providerId: string;
  name: string;
  description?: string | null;
  distanceKm?: number | string;
  ratingAvg?: number | string;
  ratingCount?: number;
}

export async function fetchProviders(type: DiscoverableProviderType, market: LaunchMarket): Promise<ProviderSummary[]> {
  if (appConfig.allowDemoMode) {
    return DEMO_PROVIDER_FIXTURES[type].map((provider) => ({ ...provider }));
  }

  const query = new URLSearchParams({
    longitude: String(market.longitude), latitude: String(market.latitude), radius: String(market.discoveryRadiusKm), type,
  });
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/discovery/providers?${query.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`PROVIDER_DISCOVERY_${response.status}`);
  const values = await response.json() as ProviderDto[];
  return values.map((value) => ({
    id: value.providerId,
    name: value.name,
    description: value.description?.trim() || '',
    distanceKm: Number(value.distanceKm ?? 0),
    rating: Number(value.ratingAvg ?? 0),
    ratingCount: Number(value.ratingCount ?? 0),
  }));
}
