import type { AppIconName } from '@/components/app-icon';

export const CUSTOMER_TABS = [
  { name: 'home', labelKey: 'tabs.home', icon: 'home' },
  { name: 'search', labelKey: 'tabs.search', icon: 'search' },
  { name: 'orders', labelKey: 'tabs.orders', icon: 'history' },
  { name: 'profile', labelKey: 'tabs.profile', icon: 'profile' },
] as const satisfies ReadonlyArray<{ name: string; labelKey: string; icon: AppIconName }>;

export const NESTED_ROUTE_FOUNDATIONS = [
  '/commerce/[slug]', '/providers/[type]/[id]', '/health/[slug]', '/grooming/[slug]', '/vet/[slug]', '/guides/[slug]',
  '/cart', '/checkout', '/orders/[id]', '/appointments/[id]', '/details/[kind]/[id]',
] as const;
