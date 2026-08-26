import type { LaunchMarket } from '@/config/markets';
import { INITIAL_MARKET } from '@/config/markets';
import { apiClient } from '@/services/api-client';
import type {
  CommerceProduct,
  ProductVariant,
  ShopProfileData,
} from '@/services/catalog-types';
import { SAMPLE_PRODUCTS } from '@/demo/catalog-data';
import {
  DEMO_PROVIDER_FIXTURES,
  demoShopImage,
} from '@/demo/customer-data';
import { appConfig } from '@/utils/app-config';

export interface PublicOutletSummary {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  pickupEnabled: boolean;
}

export interface PublicListingSummary {
  id: string;
  organizationId: string;
  outletId: string;
  outletName: string;
  name: string;
  kind: 'PRODUCT' | 'MEDICINE' | string;
  category: string;
  brand?: string | null;
  petType?: string | null;
  lifeStage?: string | null;
  packLabel?: string | null;
  sku?: string | null;
  mrpPaise: number;
  sellingPricePaise: number;
  currency: string;
  commerceMode: 'COMMERCE' | 'VIEW_ONLY' | string;
  availableQuantity: number;
  pickupEnabled: boolean;
  primaryImageUrl?: string | null;
  createdAt: string;
}

export interface PublicListingDetail extends PublicListingSummary {
  description?: string | null;
  imageUrls: string[];
}

export interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export interface PublicCatalogQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  outletId?: string;
  kind?: 'PRODUCT' | 'MEDICINE' | string;
  category?: string;
  brand?: string;
  petType?: string;
  lifeStage?: string;
  commerceMode?: 'COMMERCE' | 'VIEW_ONLY';
  availability?: 'ANY' | 'IN_STOCK' | 'OUT_OF_STOCK';
  sort?: 'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'NEWEST';
}

export interface PublicOutletQuery {
  page?: number;
  pageSize?: number;
  capability?: string;
  pincode?: string;
  q?: string;
}

export interface CommerceCatalogQuery {
  providerId?: string;
  category?: string;
  onlyNewArrivals?: boolean;
  market?: LaunchMarket;
  q?: string;
  sort?: 'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'NEWEST';
}

export function isRecent(value: string | null | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 30 * 24 * 60 * 60 * 1000;
}

export function mapListingToCommerceProduct(
  listing: PublicListingSummary | PublicListingDetail,
  outlet?: { name: string; pickupEnabled: boolean },
): CommerceProduct {
  const price = listing.sellingPricePaise / 100;
  const originalPrice =
    listing.mrpPaise > listing.sellingPricePaise
      ? listing.mrpPaise / 100
      : undefined;
  const stockCount = Math.max(0, listing.availableQuantity);
  const inStock = stockCount > 0;
  const pickupEnabled = outlet ? outlet.pickupEnabled : listing.pickupEnabled;
  const providerName = outlet ? outlet.name : listing.outletName;

  const detailImages =
    'imageUrls' in listing && Array.isArray(listing.imageUrls) && listing.imageUrls.length > 0
      ? listing.imageUrls
      : listing.primaryImageUrl
        ? [listing.primaryImageUrl]
        : [];

  const variant: ProductVariant = {
    id: listing.id,
    name: listing.packLabel || listing.sku || listing.name,
    price,
    originalPrice,
    inStock,
    stockCount,
  };

  const specifications: Record<string, string> = {
    Category: listing.category,
    Availability: inStock ? 'In stock' : 'Out of stock',
  };
  if (listing.brand) specifications.Brand = listing.brand;
  if (listing.petType) specifications['Pet Type'] = listing.petType;
  if (listing.lifeStage) specifications['Life Stage'] = listing.lifeStage;
  if (listing.packLabel) specifications.Pack = listing.packLabel;
  if (listing.sku) specifications.SKU = listing.sku;

  const suitability: string[] = [];
  if (listing.petType) suitability.push(listing.petType);
  if (listing.lifeStage) suitability.push(listing.lifeStage);

  const description =
    'description' in listing && listing.description
      ? listing.description.trim()
      : undefined;

  return {
    id: listing.id,
    name: listing.name,
    brand: listing.brand || undefined,
    category: listing.category,
    price,
    originalPrice,
    mrpPaise: listing.mrpPaise,
    sellingPricePaise: listing.sellingPricePaise,
    inStock,
    stockCount,
    availableQuantity: listing.availableQuantity,
    imageUrl: listing.primaryImageUrl || undefined,
    galleryImages: detailImages,
    description,
    createdAt: listing.createdAt || new Date(0).toISOString(),
    isNewArrival: isRecent(listing.createdAt),
    providerId: listing.outletId,
    providerName,
    organizationId: listing.organizationId,
    outletId: listing.outletId,
    kind: listing.kind,
    commerceMode: listing.commerceMode,
    pickupEnabled,
    sku: listing.sku || undefined,
    packLabel: listing.packLabel || undefined,
    variants: [variant],
    specifications,
    suitability,
    sellerInfo: {
      id: listing.outletId,
      name: providerName,
      pickupEnabled,
    },
  };
}

export async function fetchPublicOutlets(
  query: PublicOutletQuery = {},
): Promise<PageResponse<PublicOutletSummary>> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.append('page', String(query.page));
  if (query.pageSize !== undefined) params.append('pageSize', String(query.pageSize));
  params.append('capability', query.capability ?? 'PRODUCT_STORE');
  if (query.pincode) params.append('pincode', query.pincode);
  if (query.q) params.append('q', query.q);

  const url = `/api/v1/public/outlets?${params.toString()}`;
  return apiClient.get<PageResponse<PublicOutletSummary>>(url);
}

export async function fetchAllPublicOutlets(
  query: PublicOutletQuery = {},
): Promise<PublicOutletSummary[]> {
  const items: PublicOutletSummary[] = [];
  let page = 0;
  let hasNext = true;

  while (hasNext) {
    const response = await fetchPublicOutlets({ ...query, page, pageSize: query.pageSize ?? 50 });
    items.push(...response.items);
    hasNext = response.hasNext;
    page += 1;
  }

  return items;
}

export async function fetchPublicOutlet(outletId: string): Promise<PublicOutletSummary> {
  const url = `/api/v1/public/outlets/${encodeURIComponent(outletId)}`;
  return apiClient.get<PublicOutletSummary>(url);
}

export async function fetchCatalogPage(
  query: PublicCatalogQuery = {},
): Promise<PageResponse<PublicListingSummary>> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.append('page', String(query.page));
  if (query.pageSize !== undefined) params.append('pageSize', String(query.pageSize));
  if (query.q) params.append('q', query.q);
  if (query.outletId) params.append('outletId', query.outletId);
  if (query.kind) params.append('kind', query.kind);
  if (query.category) params.append('category', query.category);
  if (query.brand) params.append('brand', query.brand);
  if (query.petType) params.append('petType', query.petType);
  if (query.lifeStage) params.append('lifeStage', query.lifeStage);
  if (query.commerceMode) params.append('commerceMode', query.commerceMode);
  if (query.availability) params.append('availability', query.availability);
  if (query.sort) params.append('sort', query.sort);

  const url = `/api/v1/public/catalog?${params.toString()}`;
  return apiClient.get<PageResponse<PublicListingSummary>>(url);
}

export async function fetchAllCatalogItems(
  query: PublicCatalogQuery = {},
): Promise<PublicListingSummary[]> {
  const items: PublicListingSummary[] = [];
  let page = 0;
  let hasNext = true;

  while (hasNext) {
    const response = await fetchCatalogPage({ ...query, page, pageSize: query.pageSize ?? 50 });
    items.push(...response.items);
    hasNext = response.hasNext;
    page += 1;
  }

  return items;
}

export async function fetchCatalogListing(listingId: string): Promise<PublicListingDetail> {
  const url = `/api/v1/public/catalog/${encodeURIComponent(listingId)}`;
  return apiClient.get<PublicListingDetail>(url);
}

export function normalizeDemoCommerceProduct(product: CommerceProduct): CommerceProduct {
  const stock = product.stockCount ?? 1;
  const availableQty = product.availableQuantity ?? stock;
  return {
    ...product,
    kind: product.kind ?? 'PRODUCT',
    commerceMode: product.commerceMode ?? 'COMMERCE',
    availableQuantity: availableQty,
    stockCount: stock,
    pickupEnabled: product.pickupEnabled ?? true,
    inStock: product.inStock ?? (availableQty > 0),
  };
}

export async function fetchCommerceProduct(listingId: string): Promise<CommerceProduct> {
  if (appConfig.allowDemoMode) {
    const demo = SAMPLE_PRODUCTS.find((p) => p.id === listingId);
    if (!demo) throw new Error('DEMO_PRODUCT_NOT_FOUND');
    return normalizeDemoCommerceProduct({
      ...demo,
      galleryImages: demo.galleryImages.length > 0 ? demo.galleryImages : [demo.imageUrl || ''],
    });
  }

  const detail = await fetchCatalogListing(listingId);
  return mapListingToCommerceProduct(detail);
}

export async function fetchCommerceProducts(
  query: CommerceCatalogQuery = {},
): Promise<CommerceProduct[]> {
  if (appConfig.allowDemoMode) {
    let products = query.providerId
      ? demoProductsForProvider(query.providerId)
      : SAMPLE_PRODUCTS.map((product) => ({ ...product }));
    if (query.category) {
      products = products.filter(
        (product) => product.category.toLowerCase() === query.category?.toLowerCase(),
      );
    }
    if (query.onlyNewArrivals) products = products.filter((product) => product.isNewArrival);
    return products.map((product) =>
      normalizeDemoCommerceProduct({
        ...product,
        galleryImages:
          product.galleryImages.length > 0
            ? product.galleryImages
            : [product.imageUrl || ''],
      }),
    );
  }

  const catalogQuery: PublicCatalogQuery = {
    outletId: query.providerId,
    category: query.category,
    q: query.q,
    commerceMode: 'COMMERCE',
    sort: query.onlyNewArrivals ? 'NEWEST' : query.sort,
  };

  const listings = await fetchAllCatalogItems(catalogQuery);
  return listings.map((listing) => mapListingToCommerceProduct(listing));
}

export async function fetchShopProfile(outletId: string): Promise<ShopProfileData> {
  if (appConfig.allowDemoMode) {
    const provider = DEMO_PROVIDER_FIXTURES.PET_STORE.find((item) => item.id === outletId);
    if (!provider) throw new Error('DEMO_PROVIDER_NOT_FOUND');
    const products = demoProductsForProvider(outletId);
    return {
      id: provider.id,
      name: provider.name,
      tagline: provider.description,
      address: provider.description.split('·').at(-1)?.trim() || 'Tirupati',
      city: 'Tirupati',
      pincode: '517501',
      rating: `${provider.rating.toFixed(1)} ★`,
      reviewCount: provider.ratingCount,
      deliveryEta: '20-30 mins',
      isVerified: true,
      heroImageUrl: demoShopImage(outletId),
      openingHours: '9:00 AM – 9:00 PM',
      contactPhone: '+91 98765 43210',
      categories: Array.from(new Set(products.map((product) => product.category))).sort(),
      products,
    };
  }

  const outlet = await fetchPublicOutlet(outletId);
  const listings = await fetchAllCatalogItems({ outletId });
  const products = listings.map((listing) => mapListingToCommerceProduct(listing, outlet));
  const categories = Array.from(new Set(products.map((product) => product.category))).sort();

  return {
    id: outlet.id,
    name: outlet.name,
    pickupEnabled: outlet.pickupEnabled,
    organizationId: outlet.organizationId,
    categories,
    products,
  };
}

function demoProductsForProvider(providerId: string): CommerceProduct[] {
  const direct = SAMPLE_PRODUCTS.filter((product) => product.providerId === providerId);
  if (direct.length > 0) return direct.map((product) => normalizeDemoCommerceProduct(product));

  const provider = DEMO_PROVIDER_FIXTURES.PET_STORE.find((item) => item.id === providerId);
  if (!provider) return [];
  return SAMPLE_PRODUCTS.slice(0, 4).map((product, index) =>
    normalizeDemoCommerceProduct({
      ...product,
      id: `${providerId}-${product.id}-${index}`,
      providerId,
      providerName: provider.name,
      sellerInfo: {
        ...product.sellerInfo,
        id: providerId,
        name: provider.name,
        address: provider.description,
        rating: `${provider.rating.toFixed(1)} ★`,
      },
    }),
  );
}
