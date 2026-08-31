import { merchantApiFetch } from '../auth/session';

export type MerchantDashboardMetricKey =
  | 'pendingAppointments'
  | 'activeCatalog'
  | 'lowStockInventory'
  | 'outOfStockInventory'
  | 'orderWork';

export type MerchantDashboardMetrics = Record<MerchantDashboardMetricKey, number> & {
  lowStockThreshold: number;
};

export type MerchantDashboardSnapshot = {
  outletIds: string[];
  metrics: MerchantDashboardMetrics;
  generatedAt: string;
};

export type OperationsDestination = {
  pathname: '/appointments' | '/catalog' | '/inventory' | '/dashboard';
  params?: { appointmentId: string };
};

export type DashboardCard = {
  key: MerchantDashboardMetricKey;
  label: string;
  value: number;
  detail: string;
  destination: OperationsDestination;
};

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  const error = new Error(body?.message ?? fallback);
  error.name = body?.code ?? 'MERCHANT_API_ERROR';
  return error;
}

export async function fetchMerchantDashboard(outletId?: string): Promise<MerchantDashboardSnapshot> {
  const query = outletId ? `?outletId=${encodeURIComponent(outletId)}` : '';
  const response = await merchantApiFetch(`/api/v1/merchant/dashboard${query}`);
  if (!response.ok) throw await apiError(response, 'Could not load Merchant operations.');
  const snapshot: unknown = await response.json();
  if (!isMerchantDashboardSnapshot(snapshot)) {
    const error = new Error('The Merchant dashboard response was invalid.');
    error.name = 'MERCHANT_DASHBOARD_INVALID';
    throw error;
  }
  return snapshot;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Reject malformed responses before any value is rendered as a business metric. */
export function isMerchantDashboardSnapshot(value: unknown): value is MerchantDashboardSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<MerchantDashboardSnapshot>;
  const metrics = candidate.metrics as Partial<MerchantDashboardMetrics> | undefined;
  return Array.isArray(candidate.outletIds)
    && candidate.outletIds.every((id) => typeof id === 'string')
    && typeof candidate.generatedAt === 'string'
    && metrics !== undefined
    && isNonNegativeNumber(metrics.pendingAppointments)
    && isNonNegativeNumber(metrics.activeCatalog)
    && isNonNegativeNumber(metrics.lowStockInventory)
    && isNonNegativeNumber(metrics.outOfStockInventory)
    && isNonNegativeNumber(metrics.orderWork)
    && isNonNegativeNumber(metrics.lowStockThreshold);
}

export function dashboardMetricDestination(key: MerchantDashboardMetricKey): OperationsDestination {
  switch (key) {
    case 'pendingAppointments':
      return { pathname: '/appointments' };
    case 'activeCatalog':
      return { pathname: '/catalog' };
    case 'lowStockInventory':
    case 'outOfStockInventory':
      return { pathname: '/inventory' };
    case 'orderWork':
      return { pathname: '/dashboard' };
  }
}

export function dashboardCards(snapshot: MerchantDashboardSnapshot): DashboardCard[] {
  const { metrics } = snapshot;
  return [
    {
      key: 'pendingAppointments',
      label: 'Pending appointments',
      value: metrics.pendingAppointments,
      detail: 'Canonical BOOKED requests waiting for a decision',
      destination: dashboardMetricDestination('pendingAppointments'),
    },
    {
      key: 'orderWork',
      label: 'Order work',
      value: metrics.orderWork,
      detail: 'Placed and in-progress fulfilment work',
      destination: dashboardMetricDestination('orderWork'),
    },
    {
      key: 'activeCatalog',
      label: 'Active catalog',
      value: metrics.activeCatalog,
      detail: 'Server-active listings across this outlet scope',
      destination: dashboardMetricDestination('activeCatalog'),
    },
    {
      key: 'lowStockInventory',
      label: 'Low stock',
      value: metrics.lowStockInventory,
      detail: `Available stock between 1 and ${metrics.lowStockThreshold}`,
      destination: dashboardMetricDestination('lowStockInventory'),
    },
    {
      key: 'outOfStockInventory',
      label: 'Out of stock',
      value: metrics.outOfStockInventory,
      detail: 'Active listings with zero available stock',
      destination: dashboardMetricDestination('outOfStockInventory'),
    },
  ];
}
