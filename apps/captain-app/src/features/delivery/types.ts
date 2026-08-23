export interface CaptainActiveDelivery {
  jobId: string;
  orderId: string;
  orderReference: string;
  dispatchStatus: 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED';
  merchant?: {
    outletId: string;
    name: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    phone?: string;
    pickupInstructions?: string;
  };
  customer?: {
    name?: string;
    maskedPhone?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    deliveryInstructions?: string;
  };
  package?: {
    itemCount?: number;
    summary?: string;
  };
  earningPaise?: number;
  assignedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
}

export interface CaptainDeliveryOffer {
  offerId: string;
  jobId: string;
  expiresAt: string;
  pickup?: {
    outletName?: string;
    area?: string;
    distanceMeters?: number;
  };
  package?: {
    itemCount?: number;
  };
  estimatedEarningPaise?: number;
}
