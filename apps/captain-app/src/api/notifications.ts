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

export async function fetchCaptainNotifications(): Promise<CaptainNotificationItem[]> {
  const response = await captainApiFetch('/api/v1/captain/notifications', { timeoutMs: 8000 });
  const data = await handleApiResponse<any>(response);
  return Array.isArray(data) ? data : data.items ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const response = await captainApiFetch(`/api/v1/captain/notifications/${id}/read`, {
    method: 'POST',
    timeoutMs: 8000,
  });
  await handleApiResponse<void>(response);
}
