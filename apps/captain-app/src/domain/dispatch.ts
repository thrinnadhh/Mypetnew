export type DispatchOfferState =
  | 'PENDING'
  | 'ACCEPTING'
  | 'ACCEPTED'
  | 'REJECTING'
  | 'REJECTED'
  | 'EXPIRED'
  | 'LOST'
  | 'UNKNOWN';

export interface DeliveryAddress {
  addressId: string;
  recipientName: string;
  phoneNumber: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface DispatchOffer {
  offerId: string;
  jobId: string;
  expiresAt: string;
  state: DispatchOfferState;
  outletName?: string;
  area?: string;
  distanceMeters?: number;
  itemCount?: number;
  estimatedEarningPaise?: number;
  receivedAt: string;
}

export interface DispatchAssignment {
  accepted: boolean;
  jobId: string;
  orderId: string;
  outletId: string;
  outletName: string;
  deliveryAddress: DeliveryAddress;
}
