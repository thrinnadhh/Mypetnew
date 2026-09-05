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
  originLatitude?: number;
  originLongitude?: number;
  deliveryAddress: DeliveryAddress;
  state: DeliveryState;
  earningPaise?: number;
  itemCount?: number;
  itemsDescription?: string;
  assignedAt: string;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  pickupProof?: DeliveryProof | null;
  deliveryProof?: DeliveryProof | null;
  failureReason?: string | null;
}

/**
 * Proof secrets are transport-only. Never retain a successfully verified PIN in
 * React/domain state after the authoritative mutation completes.
 */
export function sanitizeDeliveryProof(proof?: DeliveryProof): DeliveryProof | undefined {
  if (!proof) return undefined;
  const sanitized = { ...proof };
  delete sanitized.pinCode;
  return sanitized;
}

export const DELIVERY_STATE_RANKS: Record<DeliveryState, number> = {
  ASSIGNED: 10,
  ARRIVING_PICKUP: 20,
  PICKUP_CONFIRMING: 25,
  PICKED_UP: 30,
  ARRIVING_CUSTOMER: 40,
  DELIVERY_CONFIRMING: 45,
  DELIVERED: 50,
  FAILED: 99,
  UNKNOWN: 0,
};

export function canTransitionDelivery(from: DeliveryState, to: DeliveryState): boolean {
  if (from === to) return true;

  const validTransitions: Record<DeliveryState, DeliveryState[]> = {
    ASSIGNED: ['ARRIVING_PICKUP', 'PICKUP_CONFIRMING', 'PICKED_UP', 'FAILED', 'UNKNOWN'],
    ARRIVING_PICKUP: ['PICKUP_CONFIRMING', 'PICKED_UP', 'FAILED', 'UNKNOWN'],
    PICKUP_CONFIRMING: ['PICKED_UP', 'ARRIVING_PICKUP', 'ASSIGNED', 'FAILED', 'UNKNOWN'],
    PICKED_UP: ['ARRIVING_CUSTOMER', 'DELIVERY_CONFIRMING', 'DELIVERED', 'FAILED', 'UNKNOWN'],
    ARRIVING_CUSTOMER: ['DELIVERY_CONFIRMING', 'DELIVERED', 'FAILED', 'UNKNOWN'],
    DELIVERY_CONFIRMING: ['DELIVERED', 'ARRIVING_CUSTOMER', 'PICKED_UP', 'FAILED', 'UNKNOWN'],
    DELIVERED: [],
    FAILED: [],
    UNKNOWN: [
      'ASSIGNED',
      'ARRIVING_PICKUP',
      'PICKUP_CONFIRMING',
      'PICKED_UP',
      'ARRIVING_CUSTOMER',
      'DELIVERY_CONFIRMING',
      'DELIVERED',
      'FAILED',
    ],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

export function isDeliveryStateMoreAdvanced(target: DeliveryState, current: DeliveryState): boolean {
  if (target === 'UNKNOWN') return false;
  if (current === 'UNKNOWN') return true;
  return DELIVERY_STATE_RANKS[target] > DELIVERY_STATE_RANKS[current];
}
