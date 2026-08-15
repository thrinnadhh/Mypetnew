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

const capabilitiesByType: Record<DiscoverableProviderType, string[]> = {
  GROOMER: ['GROOMING'],
  PET_STORE: ['PRODUCT_STORE'],
  VET_HOSPITAL: ['VETERINARY_CLINIC', 'VETERINARY_HOSPITAL'],
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

function toSummary(outlet: PublicOutletDto): ProviderSummary {
  return {
    id: outlet.id,
    name: outlet.name,
    description: descriptionFor(outlet),
    // The authoritative public-outlet DTO does not expose verified distance or
    // rating aggregates yet. Keep these neutral instead of fabricating values.
    distanceKm: 0,
    rating: 0,
    ratingCount: 0,
  };
}

async function fetchCapability(capability: string): Promise<PublicOutletDto[]> {
  const query = new URLSearchParams({ capability, page: '0', pageSize: '100' });
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/public/outlets?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`PROVIDER_DISCOVERY_${response.status}`);
  const payload = (await response.json()) as PageResponse<PublicOutletDto>;
  return payload.items;
}

export async function fetchProviders(type: DiscoverableProviderType, market: LaunchMarket): Promise<ProviderSummary[]> {
  if (appConfig.allowDemoMode) {
    return DEMO_PROVIDER_FIXTURES[type].map((provider) => ({ ...provider }));
  }

  // Geo ranking is intentionally not simulated client-side. The market is kept
  // in this contract for the future canonical discovery endpoint that owns it.
  void market;
  const groups = await Promise.all(capabilitiesByType[type].map(fetchCapability));
  const unique = new Map<string, PublicOutletDto>();
  for (const outlet of groups.flat()) unique.set(outlet.id, outlet);
  return [...unique.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(toSummary);
}
