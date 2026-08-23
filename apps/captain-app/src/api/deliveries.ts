import { CaptainActiveDelivery } from '../features/delivery/types';
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

export async function fetchActiveDelivery(): Promise<CaptainActiveDelivery | null> {
  try {
    const response = await captainApiFetch('/api/v1/captain/dispatch/active');
    if (response.ok) {
      return await handleApiResponse<CaptainActiveDelivery>(response);
    }
  } catch {
    // Return null if none active or endpoint not supported
  }
  return null;
}

export async function fetchDeliveryHistory(): Promise<DeliveryHistoryItem[]> {
  try {
    const response = await captainApiFetch('/api/v1/captain/deliveries/history');
    if (response.ok) {
      const data = await handleApiResponse<any>(response);
      return Array.isArray(data) ? data : data.items ?? [];
    }
  } catch {
    // Return empty list if no history yet
  }
  return [];
}
