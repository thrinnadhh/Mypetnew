import type { AppIconName } from '@/components/app-icon';

export const CUSTOMER_TABS = [
  { name: 'home', labelKey: 'tabs.home', icon: 'home' },
  { name: 'search', labelKey: 'tabs.search', icon: 'search' },
  { name: 'orders', labelKey: 'tabs.orders', icon: 'history' },
  { name: 'profile', labelKey: 'tabs.profile', icon: 'profile' },
] as const satisfies ReadonlyArray<{ name: string; labelKey: string; icon: AppIconName }>;

export const NESTED_ROUTE_FOUNDATIONS = [
  '/stores', '/shop/[id]', '/products', '/category/[id]', '/commerce/product-detail',
  '/providers/[type]/[id]',
  '/groom', '/groomer/[id]', '/grooming/[slug]',
  '/vet', '/vet/[slug]',
  '/health/[slug]', '/guides/[slug]',
  '/cart', '/checkout', '/orders/[id]', '/appointments/[id]', '/details/[kind]/[id]',
] as const;
