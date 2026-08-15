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

interface PublicOutletDto {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  pickupEnabled: boolean;
}

interface LegacyProviderDto {
  providerId: string;
  name: string;
  description?: string | null;
  distanceKm?: number | string;
  ratingAvg?: number | string;
  ratingCount?: number;
}

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

const capabilityByType: Record<DiscoverableProviderType, string> = {
  GROOMER: 'GROOMING',
  PET_STORE: 'PRODUCT_STORE',
  VET_HOSPITAL: 'VETERINARY_HOSPITAL',
};

function descriptionFor(outlet: PublicOutletDto): string {
  const labels = outlet.capabilities.map((capability) => {
    switch (capability) {
      case 'GROOMING': return 'Pet grooming';
      case 'VETERINARY_CLINIC': return 'Veterinary clinic';
      case 'VETERINARY_HOSPITAL': return 'Veterinary hospital';
      case 'PRODUCT_STORE': return 'Pet store';
      case 'MEDICINE_CATALOG_VIEW_ONLY': return 'Medicine catalogue';
      default: return capability.replaceAll('_', ' ').toLowerCase();
    }
  });
  return labels.join(' · ');
}

function isLegacyProvider(value: PublicOutletDto | LegacyProviderDto): value is LegacyProviderDto {
  return 'providerId' in value;
}

function toSummary(value: PublicOutletDto | LegacyProviderDto): ProviderSummary {
  if (isLegacyProvider(value)) {
    return {
      id: value.providerId,
      name: value.name,
      description: value.description?.trim() || '',
      distanceKm: Number(value.distanceKm ?? 0),
      rating: Number(value.ratingAvg ?? 0),
      ratingCount: Number(value.ratingCount ?? 0),
    };
  }
  return {
    id: value.id,
    name: value.name,
    description: descriptionFor(value),
    // The canonical outlet contract intentionally does not invent geo/rating
    // aggregates. These remain neutral until the backend exposes real values.
    distanceKm: 0,
    rating: 0,
    ratingCount: 0,
  };
}

export async function fetchProviders(type: DiscoverableProviderType, market: LaunchMarket): Promise<ProviderSummary[]> {
  if (appConfig.allowDemoMode) {
    return DEMO_PROVIDER_FIXTURES[type].map((provider) => ({ ...provider }));
  }

  const query = new URLSearchParams({
    capability: capabilityByType[type],
    page: '0',
    pageSize: '100',
    // Retain the legacy discovery context in the request so an API gateway can
    // use it for geo-ranking without requiring the mobile client to fork paths.
    longitude: String(market.longitude),
    latitude: String(market.latitude),
    radius: String(market.discoveryRadiusKm),
    type,
  });
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/public/outlets?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`PROVIDER_DISCOVERY_${response.status}`);

  const payload = await response.json() as PageResponse<PublicOutletDto> | LegacyProviderDto[];
  const values: Array<PublicOutletDto | LegacyProviderDto> = Array.isArray(payload) ? payload : payload.items;
  return values.map(toSummary);
}
