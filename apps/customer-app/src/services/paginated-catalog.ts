import { apiClient } from '@/services/api-client';
import type { CommerceProduct } from '@/services/catalog-types';
import { SAMPLE_PRODUCTS } from '@/demo/catalog-data';
import {
  fetchCatalogPage,
  fetchCommerceProduct,
  mapListingToCommerceProduct,
  normalizeDemoCommerceProduct,
  type PageResponse,
  type PublicCatalogQuery,
  type PublicListingDetail,
  type PublicListingSummary,
  type PublicOutletSummary,
} from '@/services/customer-catalog';
import { appConfig } from '@/utils/app-config';

export const CUSTOMER_CATALOG_PAGE_SIZE = 20;

export type ServiceableCatalogQuery = PublicCatalogQuery & {
  pincode?: string;
};

function requireValidServicePincode(pincode: string | undefined): string {
  const normalized = pincode?.trim() ?? '';
  if (!/^[1-9][0-9]{5}$/.test(normalized)) {
    throw new Error('A valid active six-digit service PIN is required for live commerce discovery.');
  }
  return normalized;
}

function demoCatalogPage(query: ServiceableCatalogQuery): PageResponse<CommerceProduct> {
  const page = query.page ?? 0;
  const pageSize = query.pageSize ?? CUSTOMER_CATALOG_PAGE_SIZE;

  if (query.kind === 'MEDICINE' || query.commerceMode === 'VIEW_ONLY') {
    return { items: [], page, pageSize, hasNext: false };
  }

  let products = SAMPLE_PRODUCTS.map((product) => normalizeDemoCommerceProduct({ ...product }));
  const normalizedQuery = query.q?.trim().toLowerCase();

  if (normalizedQuery) {
    products = products.filter((product) =>
      product.name.toLowerCase().includes(normalizedQuery)
      || product.category.toLowerCase().includes(normalizedQuery)
      || product.brand?.toLowerCase().includes(normalizedQuery)
      || product.providerName.toLowerCase().includes(normalizedQuery),
    );
  }

  if (query.category) {
    const category = query.category.toLowerCase();
    products = products.filter((product) => product.category.toLowerCase() === category);
  }

  if (query.brand) {
    const brand = query.brand.toLowerCase();
    products = products.filter((product) => product.brand?.toLowerCase() === brand);
  }

  if (query.lifeStage) {
    const lifeStage = query.lifeStage.toUpperCase();
    products = products.filter((product) =>
      product.lifeStages?.some((stage) => stage.toUpperCase() === lifeStage),
    );
  }

  if (query.availability === 'IN_STOCK') {
    products = products.filter((product) => product.inStock);
  } else if (query.availability === 'OUT_OF_STOCK') {
    products = products.filter((product) => !product.inStock);
  }

  switch (query.sort) {
    case 'PRICE_ASC':
      products.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
      break;
    case 'PRICE_DESC':
      products.sort((a, b) => b.price - a.price || a.id.localeCompare(b.id));
      break;
    case 'NEWEST':
      products.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
      break;
    case 'NAME':
    default:
      products.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      break;
  }

  const start = page * pageSize;
  const items = products.slice(start, start + pageSize);
  return {
    items,
    page,
    pageSize,
    hasNext: start + items.length < products.length,
  };
}

function appendCatalogParams(params: URLSearchParams, query: ServiceableCatalogQuery): void {
  const values: ReadonlyArray<[string, string | number | undefined]> = [
    ['page', query.page],
    ['pageSize', query.pageSize],
    ['q', query.q],
    ['outletId', query.outletId],
    ['kind', query.kind],
    ['category', query.category],
    ['brand', query.brand],
    ['petType', query.petType],
    ['lifeStage', query.lifeStage],
    ['commerceMode', query.commerceMode],
    ['availability', query.availability],
    ['sort', query.sort],
    ['pincode', query.pincode],
  ];

  for (const [key, value] of values) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
}

async function fetchServiceableCatalogPage(
  query: ServiceableCatalogQuery,
): Promise<PageResponse<PublicListingSummary>> {
  const params = new URLSearchParams();
  appendCatalogParams(params, query);
  return apiClient.get<PageResponse<PublicListingSummary>>(`/api/v1/public/catalog?${params.toString()}`);
}

export async function fetchCommerceCatalogPage(
  query: ServiceableCatalogQuery = {},
): Promise<PageResponse<CommerceProduct>> {
  const normalizedQuery: ServiceableCatalogQuery = {
    page: query.page ?? 0,
    pageSize: query.pageSize ?? CUSTOMER_CATALOG_PAGE_SIZE,
    ...query,
  };

  if (appConfig.allowDemoMode) {
    return demoCatalogPage(normalizedQuery);
  }

  const serviceScoped = Object.prototype.hasOwnProperty.call(query, 'pincode');
  if (serviceScoped) normalizedQuery.pincode = requireValidServicePincode(normalizedQuery.pincode);

  const response = serviceScoped
    ? await fetchServiceableCatalogPage(normalizedQuery)
    : await fetchCatalogPage(normalizedQuery);
  return {
    ...response,
    items: response.items.map((listing) => mapListingToCommerceProduct(listing)),
  };
}

export async function fetchProductCatalogPage(
  query: ServiceableCatalogQuery = {},
): Promise<PageResponse<CommerceProduct>> {
  return fetchCommerceCatalogPage({
    ...query,
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
  });
}

export async function fetchServiceableProductStore(
  outletId: string,
  pincode: string,
): Promise<PublicOutletSummary> {
  const servicePincode = requireValidServicePincode(pincode);
  const params = new URLSearchParams({ capability: 'PRODUCT_STORE', pincode: servicePincode });
  return apiClient.get<PublicOutletSummary>(
    `/api/v1/public/outlets/${encodeURIComponent(outletId)}?${params.toString()}`,
  );
}

export async function fetchServiceableCommerceProduct(
  listingId: string,
  pincode: string,
): Promise<CommerceProduct> {
  if (appConfig.allowDemoMode) return fetchCommerceProduct(listingId);
  const servicePincode = requireValidServicePincode(pincode);
  const params = new URLSearchParams({ pincode: servicePincode });
  const detail = await apiClient.get<PublicListingDetail>(
    `/api/v1/public/catalog/${encodeURIComponent(listingId)}?${params.toString()}`,
  );
  return mapListingToCommerceProduct(detail);
}

export function mergeUniqueProducts(
  current: readonly CommerceProduct[],
  incoming: readonly CommerceProduct[],
): CommerceProduct[] {
  const byId = new Map(current.map((product) => [product.id, product]));
  for (const product of incoming) {
    byId.set(product.id, product);
  }
  return Array.from(byId.values());
}
