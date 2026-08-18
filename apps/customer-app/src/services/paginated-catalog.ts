import type { CommerceProduct } from '@/services/catalog-data';
import { SAMPLE_PRODUCTS } from '@/services/catalog-data';
import {
  fetchCatalogPage,
  mapListingToCommerceProduct,
  normalizeDemoCommerceProduct,
  type PageResponse,
  type PublicCatalogQuery,
} from '@/services/customer-catalog';
import { appConfig } from '@/utils/app-config';

export const CUSTOMER_CATALOG_PAGE_SIZE = 20;

function demoCatalogPage(query: PublicCatalogQuery): PageResponse<CommerceProduct> {
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

export async function fetchCommerceCatalogPage(
  query: PublicCatalogQuery = {},
): Promise<PageResponse<CommerceProduct>> {
  const normalizedQuery: PublicCatalogQuery = {
    page: query.page ?? 0,
    pageSize: query.pageSize ?? CUSTOMER_CATALOG_PAGE_SIZE,
    ...query,
  };

  if (appConfig.allowDemoMode) {
    return demoCatalogPage(normalizedQuery);
  }

  const response = await fetchCatalogPage(normalizedQuery);
  return {
    ...response,
    items: response.items.map((listing) => mapListingToCommerceProduct(listing)),
  };
}

export async function fetchProductCatalogPage(
  query: PublicCatalogQuery = {},
): Promise<PageResponse<CommerceProduct>> {
  return fetchCommerceCatalogPage({
    ...query,
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
  });
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
