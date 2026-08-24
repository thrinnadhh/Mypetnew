import { DeliveryJob } from '../../domain/delivery';
import { DispatchOffer } from '../../domain/dispatch';

export * from '../../domain/delivery';
export * from '../../domain/dispatch';

export type CaptainActiveDelivery = DeliveryJob;
export type CaptainDeliveryOffer = DispatchOffer;

export type DeliveryLifecycleStep =
  | 'ASSIGNED'
  | 'ARRIVING_PICKUP'
  | 'ARRIVED_PICKUP'
  | 'PICKED_UP'
  | 'ARRIVING_DELIVERY'
  | 'ARRIVED_DELIVERY'
  | 'DELIVERED';
