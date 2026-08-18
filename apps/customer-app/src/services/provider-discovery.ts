import type { LaunchMarket } from '@/config/markets';
import { apiClient } from '@/services/api-client';
import { DEMO_PROVIDER_FIXTURES } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';

export type DiscoverableProviderType = 'VET_HOSPITAL' | 'GROOMER' | 'PET_STORE';

export interface ProviderSummary {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  capabilities: string[];
  pickupEnabled: boolean;
}

interface PublicOutletDto {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  pickupEnabled: boolean;
}

export interface ProviderPage {
  items: ProviderSummary[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export const PROVIDER_DISCOVERY_PAGE_SIZE = 20;

const capabilitiesByType: Record<DiscoverableProviderType, readonly string[]> = {
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
    organizationId: outlet.organizationId,
    name: outlet.name,
    description: descriptionFor(outlet),
    capabilities: [...outlet.capabilities],
    pickupEnabled: outlet.pickupEnabled,
  };
}

function requireValidServicePincode(pincode: string | undefined): string {
  const normalized = pincode?.trim() ?? '';
  if (!/^[1-9][0-9]{5}$/.test(normalized)) {
    throw new Error('A valid active six-digit service PIN is required for live provider discovery.');
  }
  return normalized;
}

function validatePagination(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Provider discovery pagination values are outside the supported range.');
  }
}

function mergeUniqueOutlets(items: readonly PublicOutletDto[]): PublicOutletDto[] {
  const unique = new Map<string, PublicOutletDto>();
  for (const outlet of items) unique.set(outlet.id, outlet);
  return [...unique.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

export function mergeUniqueProviders(
  current: readonly ProviderSummary[],
  incoming: readonly ProviderSummary[],
): ProviderSummary[] {
  const unique = new Map(current.map((provider) => [provider.id, provider]));
  for (const provider of incoming) unique.set(provider.id, provider);
  return [...unique.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

async function fetchCapabilityPage(
  capability: string,
  pincode: string,
  page: number,
  pageSize: number,
  q?: string,
): Promise<PageResponse<PublicOutletDto>> {
  const query = new URLSearchParams({
    capability,
    pincode,
    page: String(page),
    pageSize: String(pageSize),
  });
  const normalizedQuery = q?.trim();
  if (normalizedQuery) query.set('q', normalizedQuery);
  return apiClient.get<PageResponse<PublicOutletDto>>(
    `/api/v1/public/outlets?${query.toString()}`,
  );
}

function demoProviderPage(
  type: DiscoverableProviderType,
  page: number,
  pageSize: number,
  q?: string,
): ProviderPage {
  const normalizedQuery = q?.trim().toLowerCase();
  const source = DEMO_PROVIDER_FIXTURES[type]
    .filter((provider) => !normalizedQuery || provider.name.toLowerCase().includes(normalizedQuery))
    .map((provider) => ({
      id: provider.id,
      organizationId: `demo-${provider.id}`,
      name: provider.name,
      description: provider.description,
      capabilities: [...capabilitiesByType[type]],
      pickupEnabled: type === 'PET_STORE',
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const start = page * pageSize;
  const items = source.slice(start, start + pageSize);
  return {
    items,
    page,
    pageSize,
    hasNext: start + items.length < source.length,
  };
}

export async function fetchProviderPage(
  type: DiscoverableProviderType,
  market: LaunchMarket,
  servicePincode: string | undefined,
  options: { page?: number; pageSize?: number; q?: string } = {},
): Promise<ProviderPage> {
  const page = options.page ?? 0;
  const pageSize = options.pageSize ?? PROVIDER_DISCOVERY_PAGE_SIZE;
  validatePagination(page, pageSize);

  if (appConfig.allowDemoMode) {
    return demoProviderPage(type, page, pageSize, options.q);
  }

  void market;
  const pincode = requireValidServicePincode(servicePincode);
  const capabilities = capabilitiesByType[type];

  if (capabilities.length === 1) {
    const response = await fetchCapabilityPage(capabilities[0], pincode, page, pageSize, options.q);
    return {
      items: response.items.map(toSummary),
      page: response.page,
      pageSize: response.pageSize,
      hasNext: response.hasNext,
    };
  }

  // Veterinary discovery is an OR over clinic/hospital capabilities while the
  // public API intentionally accepts one exact capability per request. Fetch the
  // bounded source pages needed for this composite page, then dedupe and slice the
  // deterministically sorted union. An outlet advertising both capabilities is
  // therefore returned once and cannot shift later pages through duplicate rows.
  const groups = await Promise.all(capabilities.map(async (capability) => {
    const items: PublicOutletDto[] = [];
    let sourceHasNext = true;
    for (let sourcePage = 0; sourcePage <= page && sourceHasNext; sourcePage += 1) {
      const response = await fetchCapabilityPage(capability, pincode, sourcePage, pageSize, options.q);
      items.push(...response.items);
      sourceHasNext = response.hasNext;
    }
    return { items, hasNext: sourceHasNext };
  }));

  const merged = mergeUniqueOutlets(groups.flatMap((group) => group.items));
  const start = page * pageSize;
  const items = merged.slice(start, start + pageSize).map(toSummary);
  return {
    items,
    page,
    pageSize,
    hasNext: merged.length > start + items.length || groups.some((group) => group.hasNext),
  };
}

export async function fetchProviders(
  type: DiscoverableProviderType,
  market: LaunchMarket,
  servicePincode?: string,
): Promise<ProviderSummary[]> {
  const providers: ProviderSummary[] = [];
  for (let page = 0; page < 100; page += 1) {
    const response = await fetchProviderPage(type, market, servicePincode, {
      page,
      pageSize: PROVIDER_DISCOVERY_PAGE_SIZE,
    });
    providers.splice(0, providers.length, ...mergeUniqueProviders(providers, response.items));
    if (!response.hasNext) return providers;
  }
  throw new Error('Provider discovery pagination exceeded the supported client bound.');
}
