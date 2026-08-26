import type { PromoBanner } from '@/constants/content';

/**
 * Resolves a banner payload to an in-app route. Malformed or unknown targets
 * degrade to the stores discovery route instead of an invalid deep link.
 */
export function bannerRoute(banner: PromoBanner): string {
  const value = banner.targetValue?.trim();
  if (!value) return '/stores';
  if (banner.targetType === 'CATEGORY') return `/category/${encodeURIComponent(value)}`;
  if (banner.targetType === 'ROUTE' && value.startsWith('/')) return value;
  if (banner.targetType === 'PRODUCT') return `/commerce/product-detail?id=${encodeURIComponent(value)}`;
  if (banner.targetType === 'STORE') return `/shop/${encodeURIComponent(value)}`;
  return '/stores';
}
