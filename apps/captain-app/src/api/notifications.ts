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
  try {
    const response = await captainApiFetch('/api/v1/captain/notifications');
    if (response.ok) {
      const data = await handleApiResponse<any>(response);
      return Array.isArray(data) ? data : data.items ?? [];
    }
  } catch {
    // Return graceful initial state
  }

  return [];
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await captainApiFetch(`/api/v1/captain/notifications/${id}/read`, {
      method: 'POST',
    });
  } catch {
    // Ignore error
  }
}
