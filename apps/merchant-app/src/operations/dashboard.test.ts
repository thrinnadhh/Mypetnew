import { merchantApiFetch } from '../auth/session';
import {
  dashboardCards,
  dashboardMetricDestination,
  fetchMerchantDashboard,
  type MerchantDashboardSnapshot,
} from './dashboard';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;
const dashboard: MerchantDashboardSnapshot = {
  outletIds: ['outlet-1'],
  metrics: {
    pendingAppointments: 3,
    activeCatalog: 24,
    lowStockInventory: 4,
    outOfStockInventory: 2,
    orderWork: 5,
    lowStockThreshold: 5,
  },
  generatedAt: '2026-08-31T10:00:00Z',
};

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => fetchMock.mockReset());

describe('M11 canonical Merchant dashboard', () => {
  it('loads a bounded server snapshot without accepting local business values', async () => {
    fetchMock.mockResolvedValue(response(true, dashboard));
    await expect(fetchMerchantDashboard('outlet/one')).resolves.toEqual(dashboard);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/dashboard?outletId=outlet%2Fone');
  });

  it('supports the authorized all-outlet snapshot without client organization input', async () => {
    fetchMock.mockResolvedValue(response(true, dashboard));
    await expect(fetchMerchantDashboard()).resolves.toEqual(dashboard);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/dashboard');
  });

  it('rejects malformed server data before it can become a business metric', async () => {
    fetchMock.mockResolvedValue(response(true, {
      outletIds: ['outlet-1'],
      metrics: { ...dashboard.metrics, orderWork: '5' },
      generatedAt: dashboard.generatedAt,
    }));

    await expect(fetchMerchantDashboard()).rejects.toMatchObject({
      name: 'MERCHANT_DASHBOARD_INVALID',
    });
  });

  it('builds every card only from the canonical response', () => {
    expect(dashboardCards(dashboard)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'pendingAppointments', value: 3 }),
      expect.objectContaining({ key: 'activeCatalog', value: 24 }),
      expect.objectContaining({ key: 'outOfStockInventory', value: 2 }),
      expect.objectContaining({ key: 'orderWork', value: 5 }),
    ]));
    expect(dashboardMetricDestination('pendingAppointments')).toEqual({ pathname: '/appointments' });
    expect(dashboardMetricDestination('activeCatalog')).toEqual({ pathname: '/catalog' });
    expect(dashboardMetricDestination('lowStockInventory')).toEqual({ pathname: '/inventory' });
    expect(dashboardMetricDestination('outOfStockInventory')).toEqual({ pathname: '/inventory' });
    expect(dashboardMetricDestination('orderWork')).toEqual({ pathname: '/dashboard' });
  });
});
