import {
  canTransitionDelivery,
  isDeliveryStateMoreAdvanced,
  DELIVERY_STATE_RANKS,
  DeliveryState,
} from '../../../domain/delivery';

describe('Level 1: Delivery State Machine & Monotonic Progression Tests', () => {
  it('allows all strictly valid forward state transitions', () => {
    // Assigned to arriving / pickup confirmation / picked up
    expect(canTransitionDelivery('ASSIGNED', 'ARRIVING_PICKUP')).toBe(true);
    expect(canTransitionDelivery('ASSIGNED', 'PICKUP_CONFIRMING')).toBe(true);
    expect(canTransitionDelivery('ASSIGNED', 'PICKED_UP')).toBe(true);

    // Pickup confirmation to picked up
    expect(canTransitionDelivery('ARRIVING_PICKUP', 'PICKUP_CONFIRMING')).toBe(true);
    expect(canTransitionDelivery('ARRIVING_PICKUP', 'PICKED_UP')).toBe(true);
    expect(canTransitionDelivery('PICKUP_CONFIRMING', 'PICKED_UP')).toBe(true);

    // Picked up to arriving customer / delivery confirmation / delivered
    expect(canTransitionDelivery('PICKED_UP', 'ARRIVING_CUSTOMER')).toBe(true);
    expect(canTransitionDelivery('PICKED_UP', 'DELIVERY_CONFIRMING')).toBe(true);
    expect(canTransitionDelivery('PICKED_UP', 'DELIVERED')).toBe(true);

    // Arriving customer / delivery confirmation to delivered
    expect(canTransitionDelivery('ARRIVING_CUSTOMER', 'DELIVERY_CONFIRMING')).toBe(true);
    expect(canTransitionDelivery('ARRIVING_CUSTOMER', 'DELIVERED')).toBe(true);
    expect(canTransitionDelivery('DELIVERY_CONFIRMING', 'DELIVERED')).toBe(true);

    // Transitions to UNKNOWN on in-flight mutations
    expect(canTransitionDelivery('ASSIGNED', 'UNKNOWN')).toBe(true);
    expect(canTransitionDelivery('PICKUP_CONFIRMING', 'UNKNOWN')).toBe(true);
    expect(canTransitionDelivery('PICKED_UP', 'UNKNOWN')).toBe(true);
    expect(canTransitionDelivery('DELIVERY_CONFIRMING', 'UNKNOWN')).toBe(true);

    // Transitions from UNKNOWN upon authoritative reconciliation
    expect(canTransitionDelivery('UNKNOWN', 'ASSIGNED')).toBe(true);
    expect(canTransitionDelivery('UNKNOWN', 'PICKED_UP')).toBe(true);
    expect(canTransitionDelivery('UNKNOWN', 'DELIVERED')).toBe(true);
    expect(canTransitionDelivery('UNKNOWN', 'FAILED')).toBe(true);
  });

  it('strictly rejects illegal backward state transitions', () => {
    // Cannot regress from DELIVERED
    expect(canTransitionDelivery('DELIVERED', 'ASSIGNED')).toBe(false);
    expect(canTransitionDelivery('DELIVERED', 'ARRIVING_PICKUP')).toBe(false);
    expect(canTransitionDelivery('DELIVERED', 'PICKUP_CONFIRMING')).toBe(false);
    expect(canTransitionDelivery('DELIVERED', 'PICKED_UP')).toBe(false);
    expect(canTransitionDelivery('DELIVERED', 'ARRIVING_CUSTOMER')).toBe(false);
    expect(canTransitionDelivery('DELIVERED', 'DELIVERY_CONFIRMING')).toBe(false);
    expect(canTransitionDelivery('DELIVERED', 'UNKNOWN')).toBe(false);

    // Cannot regress from PICKED_UP to ASSIGNED
    expect(canTransitionDelivery('PICKED_UP', 'ASSIGNED')).toBe(false);
    expect(canTransitionDelivery('PICKED_UP', 'ARRIVING_PICKUP')).toBe(false);

    // Cannot regress from FAILED
    expect(canTransitionDelivery('FAILED', 'ASSIGNED')).toBe(false);
    expect(canTransitionDelivery('FAILED', 'PICKED_UP')).toBe(false);
    expect(canTransitionDelivery('FAILED', 'DELIVERED')).toBe(false);
  });

  it('determines monotonic advancement correctly based on state ranks', () => {
    expect(DELIVERY_STATE_RANKS.ASSIGNED).toBeLessThan(DELIVERY_STATE_RANKS.PICKED_UP);
    expect(DELIVERY_STATE_RANKS.PICKED_UP).toBeLessThan(DELIVERY_STATE_RANKS.DELIVERED);

    expect(isDeliveryStateMoreAdvanced('PICKED_UP', 'ASSIGNED')).toBe(true);
    expect(isDeliveryStateMoreAdvanced('DELIVERED', 'PICKED_UP')).toBe(true);
    expect(isDeliveryStateMoreAdvanced('DELIVERED', 'ASSIGNED')).toBe(true);

    expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'PICKED_UP')).toBe(false);
    expect(isDeliveryStateMoreAdvanced('PICKED_UP', 'DELIVERED')).toBe(false);
    expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'DELIVERED')).toBe(false);

    // UNKNOWN is never more advanced than any active business state
    expect(isDeliveryStateMoreAdvanced('UNKNOWN', 'ASSIGNED')).toBe(false);
    expect(isDeliveryStateMoreAdvanced('UNKNOWN', 'PICKED_UP')).toBe(false);
    expect(isDeliveryStateMoreAdvanced('UNKNOWN', 'DELIVERED')).toBe(false);

    // Any confirmed business state is more advanced than UNKNOWN
    expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'UNKNOWN')).toBe(true);
    expect(isDeliveryStateMoreAdvanced('PICKED_UP', 'UNKNOWN')).toBe(true);
    expect(isDeliveryStateMoreAdvanced('DELIVERED', 'UNKNOWN')).toBe(true);
  });
});
