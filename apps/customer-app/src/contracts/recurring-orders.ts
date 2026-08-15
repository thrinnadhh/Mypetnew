export const RECURRING_CADENCES = [7, 15, 25, 30, 35] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];
export type RecurringOrderStatus = 'ACTIVE' | 'PAUSED' | 'AWAITING_CONFIRMATION' | 'CANCELLED';

export interface RecurringOrderSubscription {
  subscriptionId: string;
  customerId: string;
  providerId: string;
  sourceOrderId: string;
  deliveryAddressId: string;
  cadenceDays: RecurringCadence;
  quantityMultiplier: number;
  status: RecurringOrderStatus;
  nextOrderAt: string;
  lastRemindedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReorderValidationItem {
  offeringId: string;
  offeringName: string;
  unitPrice: number;
  quantity: number;
  isAvailable: boolean;
  message?: string | null;
}

export interface RecurringOrderConfirmation {
  subscription: RecurringOrderSubscription;
  reorder: {
    originalOrderId: string;
    providerId: string;
    isProviderServiceable: boolean;
    items: ReorderValidationItem[];
    canReorder: boolean;
  };
  /** Present only after confirmation successfully creates a normal PLACED order. */
  createdOrderId?: string | null;
}

export function isRecurringCadence(value: number): value is RecurringCadence {
  return RECURRING_CADENCES.includes(value as RecurringCadence);
}
