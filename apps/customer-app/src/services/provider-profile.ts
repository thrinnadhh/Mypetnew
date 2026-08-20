import { ApiError, apiClient } from '@/services/api-client';
import { isUuid } from '@/utils/uuid';

export type ProviderProfileKind = 'store' | 'groomer' | 'vet';

export interface ProviderProfile {
  providerId: string;
  organizationId?: string;
  providerType: string;
  fulfillmentType: string;
  name: string;
  description: string | null;
  capabilities: string[];
  pickupEnabled: boolean;
  city?: string;
  ratingAvg?: number;
  ratingCount?: number;
  status?: string;
}

interface LegacyProviderProfileDto {
  providerId: string;
  providerType: string;
  fulfillmentType: string;
  name: string;
  description: string | null;
  city?: string;
  ratingAvg?: number | string;
  ratingCount?: number;
  status?: string;
  capabilities?: string[];
  pickupEnabled?: boolean;
}

interface PublicOutletDto {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  pickupEnabled: boolean;
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

function requiredCapabilities(kind: ProviderProfileKind): readonly string[] {
  switch (kind) {
    case 'store': return ['PRODUCT_STORE'];
    case 'groomer': return ['GROOMING'];
    case 'vet': return ['VETERINARY_CLINIC', 'VETERINARY_HOSPITAL'];
  }
}

function requireValidServicePincode(pincode: string | undefined): string {
  const normalized = pincode?.trim() ?? '';
  if (!/^[1-9][0-9]{5}$/.test(normalized)) {
    throw new Error('A valid active six-digit service PIN is required for provider details.');
  }
  return normalized;
}

function mapPublicOutlet(value: PublicOutletDto): ProviderProfile {
  return {
    providerId: value.id,
    organizationId: value.organizationId,
    providerType: providerTypeFor(value.capabilities),
    fulfillmentType: value.pickupEnabled ? 'PICKUP' : 'APPOINTMENT',
    name: value.name,
    description: descriptionFor(value.capabilities),
    capabilities: [...value.capabilities],
    pickupEnabled: value.pickupEnabled,
    status: 'ACTIVE',
  };
}

function mapLegacyProvider(value: LegacyProviderProfileDto): ProviderProfile {
  return {
    providerId: value.providerId,
    providerType: value.providerType,
    fulfillmentType: value.fulfillmentType,
    name: value.name,
    description: value.description,
    capabilities: value.capabilities ?? [],
    pickupEnabled: value.pickupEnabled ?? value.fulfillmentType === 'PICKUP',
    city: value.city?.trim() || undefined,
    ratingAvg: value.ratingAvg == null ? undefined : Number(value.ratingAvg),
    ratingCount: value.ratingCount == null ? undefined : Number(value.ratingCount),
    status: value.status,
  };
}

async function fetchPublicOutlet(
  providerId: string,
  pincode?: string,
  capability?: string,
): Promise<PublicOutletDto> {
  const params = new URLSearchParams();
  if (pincode) params.set('pincode', pincode);
  if (capability) params.set('capability', capability);
  const query = params.toString();
  return apiClient.get<PublicOutletDto>(
    `/api/v1/public/outlets/${encodeURIComponent(providerId)}${query ? `?${query}` : ''}`,
  );
}

export async function fetchProviderProfile(
  providerId: string,
  options: { kind?: ProviderProfileKind; pincode?: string } = {},
): Promise<ProviderProfile> {
  if (!isUuid(providerId)) {
    if (options.pincode !== undefined) {
      requireValidServicePincode(options.pincode);
      throw new Error('PROVIDER_SERVICEABILITY_UNVERIFIABLE');
    }
    const legacy = await apiClient.get<LegacyProviderProfileDto>(
      `/api/v1/providers/${encodeURIComponent(providerId)}`,
    );
    const mapped = mapLegacyProvider(legacy);
    if (options.kind) {
      const expected = requiredCapabilities(options.kind);
      const matches = mapped.capabilities.length > 0
        ? expected.some((capability) => mapped.capabilities.includes(capability))
        : (
            (options.kind === 'store' && mapped.providerType === 'PET_STORE')
            || (options.kind === 'groomer' && mapped.providerType === 'GROOMER')
            || (options.kind === 'vet' && (mapped.providerType === 'VET_HOSPITAL' || mapped.providerType === 'VET_CLINIC'))
          );
      if (!matches) throw new Error('PROVIDER_CAPABILITY_MISMATCH');
    }
    return mapped;
  }

  if (!options.kind) {
    const pincode = options.pincode === undefined
      ? undefined
      : requireValidServicePincode(options.pincode);
    return mapPublicOutlet(await fetchPublicOutlet(providerId, pincode));
  }

  const pincode = requireValidServicePincode(options.pincode);
  const expected = requiredCapabilities(options.kind);
  let lastNotFound: ApiError | null = null;

  for (const capability of expected) {
    try {
      const value = await fetchPublicOutlet(providerId, pincode, capability);
      if (!value.capabilities.includes(capability)) {
        throw new Error('PROVIDER_CAPABILITY_MISMATCH');
      }
      return mapPublicOutlet(value);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        lastNotFound = error;
        continue;
      }
      throw error;
    }
  }

  if (lastNotFound) throw lastNotFound;
  throw new Error('PROVIDER_CAPABILITY_MISMATCH');
}
