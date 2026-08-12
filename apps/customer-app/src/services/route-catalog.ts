import type { CommerceProduct } from '@/services/catalog-data';

export type CatalogRouteDefinition = {
  slug: string;
  title: string;
  subtitle: string;
  category?: CommerceProduct['category'];
  onlyNewArrivals?: boolean;
};

const ROUTES: Record<string, CatalogRouteDefinition> = {
  food: {
    slug: 'food',
    title: 'Food & Nutrition',
    subtitle: 'Daily nutrition, prescription diets, and healthy staples',
    category: 'food',
  },
  'food-nutrition': {
    slug: 'food-nutrition',
    title: 'Food & Nutrition',
    subtitle: 'Daily nutrition, prescription diets, and healthy staples',
    category: 'food',
  },
  furniture: {
    slug: 'furniture',
    title: 'Furniture & Sleep',
    subtitle: 'Comfortable beds, mats, crates, and resting spaces',
    category: 'furniture',
  },
  'furniture-sleep': {
    slug: 'furniture-sleep',
    title: 'Furniture & Sleep',
    subtitle: 'Comfortable beds, mats, crates, and resting spaces',
    category: 'furniture',
  },
  toys: {
    slug: 'toys',
    title: 'Toys & Enrichment',
    subtitle: 'Play, training, mental stimulation, and durable chews',
    category: 'toys',
  },
  'toys-enrichment': {
    slug: 'toys-enrichment',
    title: 'Toys & Enrichment',
    subtitle: 'Play, training, mental stimulation, and durable chews',
    category: 'toys',
  },
  travel: {
    slug: 'travel',
    title: 'Travel & Apparel',
    subtitle: 'Carriers, harnesses, walking gear, and weather-ready wear',
    category: 'travel',
  },
  'travel-apparel': {
    slug: 'travel-apparel',
    title: 'Travel & Apparel',
    subtitle: 'Carriers, harnesses, walking gear, and weather-ready wear',
    category: 'travel',
  },
  treats: {
    slug: 'treats',
    title: 'Treats & Chews',
    subtitle: 'Training rewards, dental chews, and high-protein treats',
    category: 'treats',
  },
  'treats-chews': {
    slug: 'treats-chews',
    title: 'Treats & Chews',
    subtitle: 'Training rewards, dental chews, and high-protein treats',
    category: 'treats',
  },
  waste: {
    slug: 'waste',
    title: 'Waste Management',
    subtitle: 'Litter, pads, bags, cleaning supplies, and odour control',
    category: 'waste',
  },
  'waste-management': {
    slug: 'waste-management',
    title: 'Waste Management',
    subtitle: 'Litter, pads, bags, cleaning supplies, and odour control',
    category: 'waste',
  },
  grooming: {
    slug: 'grooming',
    title: 'Grooming Supplies',
    subtitle: 'Coat, skin, nail, ear, and hygiene essentials',
    category: 'grooming',
  },
  'grooming-services': {
    slug: 'grooming-services',
    title: 'Grooming Supplies',
    subtitle: 'Coat, skin, nail, ear, and hygiene essentials',
    category: 'grooming',
  },
  vaccinations: {
    slug: 'vaccinations',
    title: 'Vaccinations & Tablets',
    subtitle: 'Preventive care products available through verified sellers',
    category: 'vaccinations',
  },
  'vaccinations-tablets': {
    slug: 'vaccinations-tablets',
    title: 'Vaccinations & Tablets',
    subtitle: 'Preventive care products available through verified sellers',
    category: 'vaccinations',
  },
  'new-arrivals': {
    slug: 'new-arrivals',
    title: 'New Arrivals',
    subtitle: 'Recently added products from verified local pet stores',
    onlyNewArrivals: true,
  },
};

export function normalizeRouteParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().toLowerCase();
}

export function getCatalogRoute(value: string | string[] | undefined): CatalogRouteDefinition | null {
  const slug = normalizeRouteParam(value);
  return ROUTES[slug] ?? null;
}

export const catalogRouteSlugs = Object.freeze(Object.keys(ROUTES));
