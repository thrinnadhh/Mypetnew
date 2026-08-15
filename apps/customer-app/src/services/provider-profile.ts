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

interface LegacyProviderProfileDto extends Omit<ProviderProfile, 'ratingAvg'> {
  ratingAvg: number | string;
}

interface PublicOutletDto {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  pickupEnabled: boolean;
}

function isPublicOutlet(value: LegacyProviderProfileDto | PublicOutletDto): value is PublicOutletDto {
  return 'id' in value && 'capabilities' in value;
}

function providerTypeFor(capabilities: string[]): string {
  if (capabilities.includes('VETERINARY_HOSPITAL')) return 'VET_HOSPITAL';
  if (capabilities.includes('VETERINARY_CLINIC')) return 'VET_CLINIC';
  if (capabilities.includes('GROOMING')) return 'GROOMER';
  if (capabilities.includes('PRODUCT_STORE')) return 'PET_STORE';
  return 'PROVIDER';
}

function descriptionFor(capabilities: string[]): string | null {
  const labels = capabilities.map((capability) => {
    switch (capability) {
      case 'GROOMING': return 'Pet grooming';
      case 'VETERINARY_CLINIC': return 'Veterinary clinic';
      case 'VETERINARY_HOSPITAL': return 'Veterinary hospital';
      case 'PRODUCT_STORE': return 'Pet store';
      case 'MEDICINE_CATALOG_VIEW_ONLY': return 'Medicine catalogue';
      default: return capability.replaceAll('_', ' ').toLowerCase();
    }
  });
  return labels.length > 0 ? labels.join(' · ') : null;
}

function profilePath(providerId: string): string {
  // Production outlet identifiers are UUIDs and use the canonical MyPetNew
  // public-outlet contract. Preserve the old encoded path only for historical
  // non-UUID identifiers used by legacy fixtures/deep links.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid.test(providerId)
    ? `/api/v1/public/outlets/${encodeURIComponent(providerId)}`
    : `/api/v1/providers/${encodeURIComponent(providerId)}`;
}

export async function fetchProviderProfile(providerId: string): Promise<ProviderProfile> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}${profilePath(providerId)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error(`PROVIDER_PROFILE_${response.status}`);

  const value = await response.json() as LegacyProviderProfileDto | PublicOutletDto;
  if (!isPublicOutlet(value)) {
    return {
      ...value,
      ratingAvg: Number(value.ratingAvg ?? 0),
      ratingCount: Number(value.ratingCount ?? 0),
    };
  }

  return {
    providerId: value.id,
    providerType: providerTypeFor(value.capabilities),
    fulfillmentType: value.pickupEnabled ? 'PICKUP' : 'APPOINTMENT',
    name: value.name,
    description: descriptionFor(value.capabilities),
    city: '',
    ratingAvg: 0,
    ratingCount: 0,
    status: 'ACTIVE',
  };
}
