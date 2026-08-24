import { DeliveryJob } from '../domain/delivery';
import { AppError } from '../domain/result';
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

function malformedActiveDelivery(message: string): never {
  throw new AppError({
    kind: 'ServerFailure',
    code: 'MALFORMED_ACTIVE_DELIVERY',
    message,
    status: 502,
    retryable: false,
  });
}

export function parseActiveDelivery(payload: unknown): DeliveryJob {
  if (!payload || typeof payload !== 'object') {
    return malformedActiveDelivery('Active delivery response must be an object');
  }

  const value = payload as Record<string, any>;
  const address = value.deliveryAddress as Record<string, unknown> | undefined;
  const requiredStrings = ['jobId', 'orderId', 'outletId', 'outletName', 'assignedAt'] as const;
  if (requiredStrings.some((field) => typeof value[field] !== 'string' || !value[field].trim())) {
    return malformedActiveDelivery('Active delivery response is missing required identity fields');
  }
  if (!['ASSIGNED', 'PICKED_UP'].includes(value.state) || Number.isNaN(Date.parse(value.assignedAt))) {
    return malformedActiveDelivery('Active delivery response contains an invalid state or timestamp');
  }
  if (
    typeof value.originLatitude !== 'number' ||
    typeof value.originLongitude !== 'number' ||
    value.originLatitude < -90 ||
    value.originLatitude > 90 ||
    value.originLongitude < -180 ||
    value.originLongitude > 180
  ) {
    return malformedActiveDelivery('Active delivery response contains invalid merchant coordinates');
  }
  if (!address) return malformedActiveDelivery('Active delivery response is missing the delivery address');
  for (const field of ['addressId', 'recipientName', 'phoneNumber', 'line1', 'city', 'state', 'pincode']) {
    if (typeof address[field] !== 'string' || !address[field]) {
      return malformedActiveDelivery('Active delivery response contains an invalid delivery address');
    }
  }

  return {
    jobId: value.jobId,
    orderId: value.orderId,
    orderReference: typeof value.orderReference === 'string' ? value.orderReference : undefined,
    outletId: value.outletId,
    outletName: value.outletName,
    originLatitude: value.originLatitude,
    originLongitude: value.originLongitude,
    deliveryAddress: {
      addressId: address.addressId as string,
      recipientName: address.recipientName as string,
      phoneNumber: address.phoneNumber as string,
      line1: address.line1 as string,
      line2: typeof address.line2 === 'string' ? address.line2 : null,
      city: address.city as string,
      state: address.state as string,
      pincode: address.pincode as string,
    },
    state: value.state,
    itemCount: typeof value.itemCount === 'number' ? value.itemCount : undefined,
    assignedAt: value.assignedAt,
    pickedUpAt: typeof value.pickedUpAt === 'string' ? value.pickedUpAt : null,
    deliveredAt: typeof value.deliveredAt === 'string' ? value.deliveredAt : null,
    failureReason: typeof value.failureReason === 'string' ? value.failureReason : null,
  };
}

export async function fetchActiveDelivery(): Promise<DeliveryJob | null> {
  const response = await captainApiFetch('/api/v1/captain/dispatch/active', { timeoutMs: 8000 });
  if (response.status === 404 || response.status === 204) {
    return null;
  }
  return parseActiveDelivery(await handleApiResponse<unknown>(response));
}

export async function fetchDeliveryHistory(): Promise<DeliveryHistoryItem[]> {
  const response = await captainApiFetch('/api/v1/captain/deliveries/history', { timeoutMs: 8000 });
  const data = await handleApiResponse<any>(response);
  return Array.isArray(data) ? data : data.items ?? [];
}
