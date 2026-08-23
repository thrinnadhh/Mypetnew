import { DeliveryAddress } from './dispatch';

export type DeliveryState =
  | 'ASSIGNED'
  | 'ARRIVING_PICKUP'
  | 'PICKUP_CONFIRMING'
  | 'PICKED_UP'
  | 'ARRIVING_CUSTOMER'
  | 'DELIVERY_CONFIRMING'
  | 'DELIVERED'
  | 'FAILED'
  | 'UNKNOWN';

export interface DeliveryProof {
  type: 'PIN' | 'PHOTO' | 'SIGNATURE';
  pinCode?: string;
  photoUri?: string;
  notes?: string;
  capturedAt: string;
}

export interface DeliveryJob {
  jobId: string;
  orderId: string;
  orderReference?: string;
  outletId: string;
  outletName: string;
  originLatitude: number;
  originLongitude: number;
  deliveryAddress: DeliveryAddress;
  state: DeliveryState;
  earningPaise: number;
  itemCount?: number;
  itemsDescription?: string;
  assignedAt: string;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  pickupProof?: DeliveryProof | null;
  deliveryProof?: DeliveryProof | null;
  failureReason?: string | null;
}

export function canTransitionDelivery(from: DeliveryState, to: DeliveryState): boolean {
  const validTransitions: Record<DeliveryState, DeliveryState[]> = {
    ASSIGNED: ['ARRIVING_PICKUP', 'PICKUP_CONFIRMING', 'PICKED_UP', 'FAILED', 'UNKNOWN'],
    ARRIVING_PICKUP: ['PICKUP_CONFIRMING', 'PICKED_UP', 'FAILED', 'UNKNOWN'],
    PICKUP_CONFIRMING: ['PICKED_UP', 'ARRIVING_PICKUP', 'FAILED', 'UNKNOWN'],
    PICKED_UP: ['ARRIVING_CUSTOMER', 'DELIVERY_CONFIRMING', 'DELIVERED', 'FAILED', 'UNKNOWN'],
    ARRIVING_CUSTOMER: ['DELIVERY_CONFIRMING', 'DELIVERED', 'FAILED', 'UNKNOWN'],
    DELIVERY_CONFIRMING: ['DELIVERED', 'ARRIVING_CUSTOMER', 'FAILED', 'UNKNOWN'],
    DELIVERED: [],
    FAILED: [],
    UNKNOWN: ['ASSIGNED', 'ARRIVING_PICKUP', 'PICKUP_CONFIRMING', 'PICKED_UP', 'ARRIVING_CUSTOMER', 'DELIVERY_CONFIRMING', 'DELIVERED', 'FAILED'],
  };

  return validTransitions[from]?.includes(to) ?? false;
}
