import type { LaunchMarket } from '@/config/markets';
import { INITIAL_MARKET } from '@/config/markets';
import type {
  CommerceProduct,
  ProductVariant,
  ShopProfileData,
} from '@/services/catalog-data';
import { SAMPLE_PRODUCTS } from '@/services/catalog-data';
import {
  DEMO_MEDIA,
  DEMO_PROVIDER_FIXTURES,
  demoShopImage,
} from '@/services/demo-customer-data';
import {
  fetchProviders,
  type ProviderSummary,
} from '@/services/provider-discovery';
import { appConfig } from '@/utils/app-config';

const DEFAULT_PRODUCT_IMAGE = DEMO_MEDIA.store;
const DEFAULT_STORE_IMAGE = DEMO_MEDIA.store;

interface BackendOffering {
  offeringId: string;
  providerId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price: number | string;
  imageUrl?: string | null;
  status?: string | null;
  stockQuantity?: number | null;
  sku?: string | null;
  durationMinutes?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface PublicProvider {
  providerId: string;
  providerType: string;
  fulfillmentType: string;
  name: string;
  description?: string | null;
  city?: string | null;
  status?: string | null;
  ratingAvg?: number | string | null;
  ratingCount?: number | null;
}

export interface CommerceCatalogQuery {
  providerId?: string;
  category?: string;
  onlyNewArrivals?: boolean;
  market?: LaunchMarket;
}

async function fetchJson<T>(path: string): Promise<T> {
  const baseUrl = appConfig.apiBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CATALOG_${response.status}`);
  }

  return (await response.json()) as T;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCategory(value: string | null | undefined): string {
  const normalized = (value ?? 'other').trim().toLowerCase();

  if (normalized.includes('food') || normalized.includes('nutrition')) return 'food';
  if (normalized.includes('bed') || normalized.includes('furniture') || normalized.includes('sleep')) return 'furniture';
  if (normalized.includes('toy') || normalized.includes('enrichment')) return 'toys';
  if (normalized.includes('travel') || normalized.includes('apparel') || normalized.includes('appearance') || normalized.includes('harness')) return 'travel';
  if (normalized.includes('treat') || normalized.includes('chew')) return 'treats';
  if (normalized.includes('waste') || normalized.includes('litter') || normalized.includes('clean')) return 'waste';
  if (normalized.includes('groom')) return 'grooming';
  if (normalized.includes('vaccin') || normalized.includes('deworm') || normalized.includes('tablet')) return 'vaccinations';

  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'other';
}

function categoryFallbackImage(category: string): string {
  switch (category) {
    case 'food': return DEMO_MEDIA.food;
    case 'furniture': return DEMO_MEDIA.furniture;
    case 'toys': return DEMO_MEDIA.toys;
    case 'travel': return DEMO_MEDIA.travel;
    case 'treats': return DEMO_MEDIA.treats;
    case 'grooming': return DEMO_MEDIA.grooming;
    case 'hospitals':
    case 'vaccinations': return DEMO_MEDIA.hospital;
    default: return DEFAULT_PRODUCT_IMAGE;
  }
}

function isRecent(value: string | null | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 30 * 24 * 60 * 60 * 1000;
}

function providerSummaryFromPublic(provider: PublicProvider): ProviderSummary {
  return {
    id: provider.providerId,
    name: provider.name,
    description: provider.description?.trim() || '',
    distanceKm: 0,
    rating: toNumber(provider.ratingAvg),
    ratingCount: provider.ratingCount ?? 0,
  };
}

function mapOffering(
  offering: BackendOffering,
  provider: ProviderSummary,
): CommerceProduct {
  const price = toNumber(offering.price);
  const stockCount = Math.max(0, offering.stockQuantity ?? 0);
  const category = normalizeCategory(offering.category);
  const active = !offering.status || offering.status.toUpperCase() === 'ACTIVE';
  const inStock = active && stockCount > 0;
  const imageUrl = offering.imageUrl?.trim() || categoryFallbackImage(category);
  const variant: ProductVariant = {
    id: `${offering.offeringId}:default`,
    name: offering.sku?.trim() || 'Standard',
    price,
    inStock,
    stockCount,
  };

  return {
    id: offering.offeringId,
    name: offering.name,
    brand: provider.name,
    category,
    price,
    rating: `${provider.rating.toFixed(1)} ★`,
    reviewCount: provider.ratingCount,
    deliveryTime: provider.distanceKm > 0 ? `${Math.max(15, Math.round(provider.distanceKm * 8))}-${Math.max(25, Math.round(provider.distanceKm * 8) + 10)} mins` : 'Same-day delivery',
    inStock,
    stockCount,
    imageUrl,
    galleryImages: [imageUrl],
    description: offering.description?.trim() || `${offering.name} from ${provider.name}.`,
    createdAt: offering.createdAt || offering.updatedAt || new Date(0).toISOString(),
    isNewArrival: isRecent(offering.createdAt),
    providerId: offering.providerId,
    providerName: provider.name,
    variants: [variant],
    specifications: {
      Category: offering.category?.trim() || 'Pet supplies',
      SKU: offering.sku?.trim() || 'Not specified',
      Availability: inStock ? 'In stock' : 'Out of stock',
    },
    suitability: ['Pets'],
    sellerInfo: {
      id: offering.providerId,
      name: provider.name,
      address: provider.description || 'Local verified pet store',
      verified: true,
      rating: `${provider.rating.toFixed(1)} ★`,
    },
    deliveryEstimate: provider.distanceKm > 0
      ? `Estimated delivery from ${provider.distanceKm.toFixed(1)} km away`
      : 'Same-day local delivery',
    returnPolicy: 'Returns and replacements are subject to the seller policy shown at checkout.',
  };
}

function demoProductsForProvider(providerId: string): CommerceProduct[] {
  const direct = SAMPLE_PRODUCTS.filter((product) => product.providerId === providerId);
  if (direct.length > 0) return direct.map((product) => ({ ...product }));

  const provider = DEMO_PROVIDER_FIXTURES.PET_STORE.find((item) => item.id === providerId);
  if (!provider) return [];
  return SAMPLE_PRODUCTS.slice(0, 4).map((product, index) => ({
    ...product,
    id: `${providerId}-${product.id}-${index}`,
    providerId,
    providerName: provider.name,
    imageUrl: product.imageUrl || categoryFallbackImage(product.category),
    sellerInfo: {
      ...product.sellerInfo,
      id: providerId,
      name: provider.name,
      address: provider.description,
      rating: `${provider.rating.toFixed(1)} ★`,
    },
  }));
}

export async function fetchPublicProvider(providerId: string): Promise<PublicProvider> {
  if (appConfig.allowDemoMode) {
    const fixture = DEMO_PROVIDER_FIXTURES.PET_STORE.find((provider) => provider.id === providerId);
    if (!fixture) throw new Error('DEMO_PROVIDER_NOT_FOUND');
    return {
      providerId: fixture.id,
      providerType: 'PET_STORE',
      fulfillmentType: 'DELIVERY',
      name: fixture.name,
      description: fixture.description,
      city: 'Tirupati',
      status: 'ACTIVE',
      ratingAvg: fixture.rating,
      ratingCount: fixture.ratingCount,
    };
  }
  return fetchJson<PublicProvider>(`/api/v1/providers/${encodeURIComponent(providerId)}`);
}

export async function fetchProviderOfferings(providerId: string): Promise<BackendOffering[]> {
  if (appConfig.allowDemoMode) {
    return demoProductsForProvider(providerId).map((product) => ({
      offeringId: product.id,
      providerId: product.providerId,
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price,
      imageUrl: product.imageUrl,
      status: product.inStock ? 'ACTIVE' : 'INACTIVE',
      stockQuantity: product.stockCount,
      sku: product.variants[0]?.name ?? 'Standard',
      createdAt: product.createdAt,
    }));
  }
  const values = await fetchJson<BackendOffering[]>(
    `/api/v1/catalog/offerings?providerId=${encodeURIComponent(providerId)}`,
  );
  return values.filter((offering) => !offering.status || offering.status.toUpperCase() === 'ACTIVE');
}

export async function fetchCommerceProduct(offeringId: string): Promise<CommerceProduct> {
  if (appConfig.allowDemoMode) {
    const product = SAMPLE_PRODUCTS.find((item) => item.id === offeringId)
      ?? DEMO_PROVIDER_FIXTURES.PET_STORE.flatMap((provider) => demoProductsForProvider(provider.id)).find((item) => item.id === offeringId);
    if (!product) throw new Error('DEMO_PRODUCT_NOT_FOUND');
    return { ...product };
  }
  const offering = await fetchJson<BackendOffering>(
    `/api/v1/catalog/offerings/${encodeURIComponent(offeringId)}`,
  );
  const provider = providerSummaryFromPublic(await fetchPublicProvider(offering.providerId));
  return mapOffering(offering, provider);
}

export async function fetchCommerceProducts(
  query: CommerceCatalogQuery = {},
): Promise<CommerceProduct[]> {
  if (appConfig.allowDemoMode) {
    let products = query.providerId
      ? demoProductsForProvider(query.providerId)
      : SAMPLE_PRODUCTS.map((product) => ({ ...product }));
    if (query.category) {
      const category = normalizeCategory(query.category);
      products = products.filter((product) => normalizeCategory(product.category) === category);
    }
    if (query.onlyNewArrivals) products = products.filter((product) => product.isNewArrival);
    return products.map((product) => ({
      ...product,
      imageUrl: product.imageUrl || categoryFallbackImage(product.category),
      galleryImages: product.galleryImages.length > 0 ? product.galleryImages : [product.imageUrl || categoryFallbackImage(product.category)],
    }));
  }

  const market = query.market ?? INITIAL_MARKET;
  const providers = query.providerId
    ? [providerSummaryFromPublic(await fetchPublicProvider(query.providerId))]
    : await fetchProviders('PET_STORE', market);

  const groups = await Promise.all(
    providers.map(async (provider) => {
      const offerings = await fetchProviderOfferings(provider.id);
      return offerings.map((offering) => mapOffering(offering, provider));
    }),
  );

  let products = groups.flat();
  if (query.category) {
    const category = normalizeCategory(query.category);
    products = products.filter((product) => product.category === category);
  }
  if (query.onlyNewArrivals) {
    products = products.filter((product) => product.isNewArrival);
  }
  return products;
}

export async function fetchShopProfile(providerId: string): Promise<ShopProfileData> {
  if (appConfig.allowDemoMode) {
    const provider = DEMO_PROVIDER_FIXTURES.PET_STORE.find((item) => item.id === providerId);
    if (!provider) throw new Error('DEMO_PROVIDER_NOT_FOUND');
    const products = demoProductsForProvider(providerId);
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
      heroImageUrl: demoShopImage(providerId),
      openingHours: '9:00 AM – 9:00 PM',
      contactPhone: '+91 98765 43210',
      categories: Array.from(new Set(products.map((product) => product.category))).sort(),
      products,
    };
  }

  const provider = await fetchPublicProvider(providerId);
  const summary = providerSummaryFromPublic(provider);
  const products = (await fetchProviderOfferings(providerId)).map((offering) =>
    mapOffering(offering, summary),
  );
  const categories = Array.from(new Set(products.map((product) => product.category))).sort();

  return {
    id: provider.providerId,
    name: provider.name,
    tagline: provider.description?.trim() || 'Verified local pet store',
    address: provider.city?.trim() || 'Local service area',
    city: provider.city?.trim() || '',
    pincode: '',
    rating: `${toNumber(provider.ratingAvg).toFixed(1)} ★`,
    reviewCount: provider.ratingCount ?? 0,
    deliveryEta: 'Same-day delivery',
    isVerified: provider.status?.toUpperCase() === 'ACTIVE',
    heroImageUrl: DEFAULT_STORE_IMAGE,
    openingHours: 'Store hours confirmed during checkout',
    contactPhone: '',
    categories,
    products,
  };
}
