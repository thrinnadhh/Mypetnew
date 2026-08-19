export const RECURRING_CADENCES = [7, 15, 25, 30, 35] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];
export type RecurringOrderStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'AWAITING_CONFIRMATION';
export type RenewalProposalStatus =
  | 'DUE'
  | 'REVALIDATION_FAILED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'ORDER_CREATED'
  | 'EXPIRED'
  | 'SKIPPED';

export interface RecurringOrderSubscription {
  subscriptionId: string;
  customerId: string;
  providerId: string;
  sourceOrderId: string;
  deliveryAddressId?: string | null;
  fulfilmentMode: 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
  cadenceDays: RecurringCadence;
  quantityMultiplier: number;
  status: RecurringOrderStatus;
  nextOrderAt: string;
  lastRemindedAt?: string | null;
  timeZone: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RenewalProposal {
  proposalId: string;
  subscriptionId: string;
  providerId: string;
  sourceOrderId: string;
  deliveryAddressId?: string | null;
  fulfilmentMode: 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
  cadenceDays: RecurringCadence;
  quantityMultiplier: number;
  dueCycleAt: string;
  status: RenewalProposalStatus;
  expiresAt: string;
  revalidatedAt?: string | null;
  confirmedAt?: string | null;
  orderId?: string | null;
  failureReason?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReorderValidationItem {
  offeringId: string;
  offeringName: string;
  unitPricePaise: number;
  quantity: number;
  isAvailable: boolean;
  message?: string | null;
}

export interface RecurringOrderConfirmation {
  subscription: RecurringOrderSubscription;
  proposal: RenewalProposal;
  reorder: {
    originalOrderId: string;
    providerId: string;
    isProviderServiceable: boolean;
    items: ReorderValidationItem[];
    canReorder: boolean;
  };
  createdOrderId?: string | null;
}

export function isRecurringCadence(value: number): value is RecurringCadence {
  return RECURRING_CADENCES.includes(value as RecurringCadence);
}
