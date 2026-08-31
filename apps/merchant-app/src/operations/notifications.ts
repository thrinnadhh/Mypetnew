import { merchantApiFetch } from '../auth/session';
import type { OperationsDestination } from './dashboard';

export type MerchantNotification = {
  id: string;
  title: string;
  body: string;
  resourceId: string;
  payload: Record<string, string>;
  createdAt: string;
};

export type MerchantNotificationPage = {
  items: MerchantNotification[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DASHBOARD: OperationsDestination = { pathname: '/dashboard' };

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  const error = new Error(body?.message ?? fallback);
  error.name = body?.code ?? 'MERCHANT_API_ERROR';
  return error;
}

export async function fetchMerchantNotifications(
  page = 0,
  pageSize = 50,
): Promise<MerchantNotificationPage> {
  const response = await merchantApiFetch(`/api/v1/notifications?page=${page}&pageSize=${pageSize}`);
  if (!response.ok) throw await apiError(response, 'Could not load notifications.');
  return (await response.json()) as MerchantNotificationPage;
}

export function notificationDestination(notification: MerchantNotification): OperationsDestination {
  switch (notification.payload?.route) {
    case 'merchant/appointments/detail':
      return UUID.test(notification.resourceId)
        ? { pathname: '/appointments', params: { appointmentId: notification.resourceId } }
        : DASHBOARD;
    case 'merchant/orders/detail':
      return DASHBOARD;
    case 'merchant/catalog/detail':
      return { pathname: '/catalog' };
    case 'merchant/inventory/detail':
      return { pathname: '/inventory' };
    default:
      return DASHBOARD;
  }
}
