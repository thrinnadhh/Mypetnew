import { DeliveryJob } from '../domain/delivery';
import { captainApiFetch, handleApiResponse } from './client';

export interface DeliveryHistoryItem {
  deliveryId: string;
  orderId: string;
  orderReference: string;
  merchantName: string;
  deliveredAt: string;
  earningPaise: number;
  status: 'DELIVERED' | 'CANCELLED';
}

export interface PaginatedDeliveries {
  items: DeliveryHistoryItem[];
  nextCursor?: string | null;
}

export async function fetchActiveDelivery(): Promise<DeliveryJob | null> {
  const response = await captainApiFetch('/api/v1/captain/dispatch/active', { timeoutMs: 8000 });
  if (response.status === 404 || response.status === 204) {
    return null;
  }
  return await handleApiResponse<DeliveryJob>(response);
}

export async function fetchDeliveryHistory(): Promise<DeliveryHistoryItem[]> {
  const response = await captainApiFetch('/api/v1/captain/deliveries/history', { timeoutMs: 8000 });
  const data = await handleApiResponse<any>(response);
  return Array.isArray(data) ? data : data.items ?? [];
}
