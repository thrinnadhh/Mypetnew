import { captainApiFetch, handleApiResponse } from './client';

export type NotificationType =
  | 'OFFER'
  | 'ASSIGNMENT'
  | 'KYC_UPDATE'
  | 'SETTLEMENT'
  | 'ANNOUNCEMENT'
  | 'WARNING';

export interface CaptainNotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  resourceId?: string;
  route?: string;
}

interface RawNotificationItem {
  id: string;
  title: string;
  body?: string;
  message?: string;
  createdAt: string;
  payload?: Record<string, string>;
  resourceId?: string | null;
  templateVersion?: string;
}

interface NotificationPageResponse {
  items: RawNotificationItem[];
}

const localReadIds = new Set<string>();

export async function fetchCaptainNotifications(): Promise<CaptainNotificationItem[]> {
  const response = await captainApiFetch('/api/v1/notifications', { timeoutMs: 8000 });
  const data = await handleApiResponse<NotificationPageResponse | RawNotificationItem[]>(response);
  const items: RawNotificationItem[] = Array.isArray(data) ? data : data.items ?? [];

  return items.map((item) => ({
    id: item.id,
    type: (item.payload?.eventType || 'ANNOUNCEMENT') as NotificationType,
    title: item.title || 'Notification',
    message: item.body || item.message || '',
    createdAt: item.createdAt,
    read: localReadIds.has(item.id),
    resourceId: item.resourceId ? String(item.resourceId) : undefined,
    route: item.payload?.route,
  }));
}

export async function markNotificationRead(id: string): Promise<void> {
  // Backend notification domain is an immutable event projection without persisted read-receipts.
  // We record read state locally without attempting fake network mutations.
  localReadIds.add(id);
}
