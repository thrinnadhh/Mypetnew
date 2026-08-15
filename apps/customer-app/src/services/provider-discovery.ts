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

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

const capabilityByType: Record<Exclude<DiscoverableProviderType, 'VET_HOSPITAL'>, string> = {
  GROOMER: 'GROOMING',
  PET_STORE: 'PRODUCT_STORE',
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

async function fetchOutlets(capability: string): Promise<PublicOutletDto[]> {
  const query = new URLSearchParams({ capability, page: '0', pageSize: '100' });
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/public/outlets?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`PROVIDER_DISCOVERY_${response.status}`);
  const page = await response.json() as PageResponse<PublicOutletDto>;
  return Array.isArray(page) ? page : page.items;
}

export async function fetchProviders(type: DiscoverableProviderType, market: LaunchMarket): Promise<ProviderSummary[]> {
  if (appConfig.allowDemoMode) {
    return DEMO_PROVIDER_FIXTURES[type].map((provider) => ({ ...provider }));
  }

  // MyPetNew exposes provider discovery through the canonical public-outlet API.
  // Location remains part of the public client contract for future geo ranking,
  // but the current backend filters providers by capability/serviceability rather
  // than accepting legacy longitude/latitude/radius parameters.
  void market;

  const capabilities = type === 'VET_HOSPITAL'
    ? ['VETERINARY_HOSPITAL', 'VETERINARY_CLINIC']
    : [capabilityByType[type]];
  const groups = await Promise.all(capabilities.map(fetchOutlets));
  const byId = new Map<string, PublicOutletDto>();
  groups.flat().forEach((outlet) => byId.set(outlet.id, outlet));

  return [...byId.values()].map((outlet) => ({
    id: outlet.id,
    name: outlet.name,
    description: descriptionFor(outlet),
    // Canonical public outlets do not yet expose geo/rating aggregates. Keep
    // neutral values instead of inventing customer-facing data.
    distanceKm: 0,
    rating: 0,
    ratingCount: 0,
  }));
}
