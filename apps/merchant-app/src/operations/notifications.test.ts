import { merchantApiFetch } from '../auth/session';
import {
  fetchMerchantNotifications,
  notificationDestination,
  type MerchantNotification,
} from './notifications';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;

function notification(route: string, resourceId = '5e1b20ac-3cc0-4180-aa91-3b7eeb447ccb'): MerchantNotification {
  return {
    id: 'notification-1',
    title: 'Update',
    body: 'Open the Merchant app.',
    resourceId,
    createdAt: '2026-08-31T10:00:00Z',
    payload: { route, resourceId },
  };
}

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => fetchMock.mockReset());

describe('M11 Merchant notification inbox and route allowlist', () => {
  it('loads a bounded page from the canonical notification inbox', async () => {
    const page = { items: [notification('merchant/appointments/detail')], page: 0, pageSize: 50, hasNext: false };
    fetchMock.mockResolvedValue(response(true, page));
    await expect(fetchMerchantNotifications()).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notifications?page=0&pageSize=50');
  });

  it('routes only recognized Merchant resources and preserves appointment IDs as navigation hints', () => {
    expect(notificationDestination(notification('merchant/appointments/detail'))).toEqual({
      pathname: '/appointments',
      params: { appointmentId: '5e1b20ac-3cc0-4180-aa91-3b7eeb447ccb' },
    });
    expect(notificationDestination(notification('merchant/orders/detail'))).toEqual({
      pathname: '/dashboard',
    });
    expect(notificationDestination(notification('merchant/catalog/detail'))).toEqual({
      pathname: '/catalog',
    });
    expect(notificationDestination(notification('merchant/inventory/detail'))).toEqual({
      pathname: '/inventory',
    });
  });

  it.each([
    'https://evil.example/steal',
    'javascript:alert(1)',
    '/admin',
    'customer/orders/detail',
    '',
  ])('uses the safe dashboard fallback for unrecognized route %p', (route) => {
    expect(notificationDestination(notification(route))).toEqual({ pathname: '/dashboard' });
  });

  it('drops invalid appointment resource identifiers instead of constructing a deep link', () => {
    expect(notificationDestination(notification('merchant/appointments/detail', '../other'))).toEqual({ pathname: '/dashboard' });
  });
});
