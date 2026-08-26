import type { PromoBanner } from '@/constants/content';

function isSafeInternalRoute(value: string): boolean {
  const safeShape = (candidate: string) => {
    if (!candidate.startsWith('/') || candidate.startsWith('//')) return false;
    if (candidate.includes('\\') || /[\u0000-\u001F\u007F]/.test(candidate)) return false;
    const path = candidate.split(/[?#]/, 1)[0];
    return !path.split('/').some((segment) => segment === '..');
  };

  if (!safeShape(value)) return false;
  try {
    return safeShape(decodeURIComponent(value));
  } catch {
    return false;
  }
}

/**
 * Resolves a banner payload to an in-app route. Malformed or unknown targets
 * degrade to the stores discovery route instead of an invalid deep link.
 */
export function bannerRoute(banner: PromoBanner): string {
  const value = banner.targetValue?.trim();
  if (!value) return '/stores';
  if (banner.targetType === 'CATEGORY') return `/category/${encodeURIComponent(value)}`;
  if (banner.targetType === 'ROUTE' && isSafeInternalRoute(value)) return value;
  if (banner.targetType === 'PRODUCT') return `/commerce/product-detail?id=${encodeURIComponent(value)}`;
  if (banner.targetType === 'STORE') return `/shop/${encodeURIComponent(value)}`;
  return '/stores';
}
