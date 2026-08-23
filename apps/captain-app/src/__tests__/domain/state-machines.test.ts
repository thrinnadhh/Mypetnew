import {
  canTransitionDelivery,
  isDeliveryStateMoreAdvanced,
  DELIVERY_STATE_RANKS,
} from '../../domain/delivery';
import { computeCaptainState, CaptainProfile } from '../../domain/captain';

describe('Domain State Machines', () => {
  describe('Delivery State Machine', () => {
    it('allows valid forward state transitions', () => {
      expect(canTransitionDelivery('ASSIGNED', 'ARRIVING_PICKUP')).toBe(true);
      expect(canTransitionDelivery('ASSIGNED', 'PICKUP_CONFIRMING')).toBe(true);
      expect(canTransitionDelivery('ASSIGNED', 'PICKED_UP')).toBe(true);
      expect(canTransitionDelivery('PICKUP_CONFIRMING', 'PICKED_UP')).toBe(true);
      expect(canTransitionDelivery('PICKED_UP', 'ARRIVING_CUSTOMER')).toBe(true);
      expect(canTransitionDelivery('PICKED_UP', 'DELIVERY_CONFIRMING')).toBe(true);
      expect(canTransitionDelivery('PICKED_UP', 'DELIVERED')).toBe(true);
      expect(canTransitionDelivery('DELIVERY_CONFIRMING', 'DELIVERED')).toBe(true);
      expect(canTransitionDelivery('ASSIGNED', 'UNKNOWN')).toBe(true);
      expect(canTransitionDelivery('PICKUP_CONFIRMING', 'UNKNOWN')).toBe(true);
      expect(canTransitionDelivery('DELIVERY_CONFIRMING', 'UNKNOWN')).toBe(true);
      expect(canTransitionDelivery('UNKNOWN', 'PICKED_UP')).toBe(true);
      expect(canTransitionDelivery('UNKNOWN', 'DELIVERED')).toBe(true);
    });

    it('rejects invalid backwards state transitions', () => {
      expect(canTransitionDelivery('DELIVERED', 'ASSIGNED')).toBe(false);
      expect(canTransitionDelivery('DELIVERED', 'PICKED_UP')).toBe(false);
      expect(canTransitionDelivery('PICKED_UP', 'ASSIGNED')).toBe(false);
      expect(canTransitionDelivery('FAILED', 'PICKED_UP')).toBe(false);
    });

    it('determines monotonic state advancement correctly', () => {
      expect(isDeliveryStateMoreAdvanced('PICKED_UP', 'ASSIGNED')).toBe(true);
      expect(isDeliveryStateMoreAdvanced('DELIVERED', 'PICKED_UP')).toBe(true);
      expect(isDeliveryStateMoreAdvanced('DELIVERED', 'ASSIGNED')).toBe(true);
      expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'DELIVERED')).toBe(false);
      expect(isDeliveryStateMoreAdvanced('PICKED_UP', 'DELIVERED')).toBe(false);
      expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'PICKED_UP')).toBe(false);
    });

    it('prevents stale out-of-order responses from regressing delivery state', () => {
      const currentState = 'DELIVERED';
      const staleIncomingState = 'PICKED_UP';
      expect(isDeliveryStateMoreAdvanced(staleIncomingState, currentState)).toBe(false);
    });
  });

  describe('Captain State Machine', () => {
    it('evaluates UNAUTHENTICATED when not logged in', () => {
      expect(computeCaptainState(false, null, false)).toBe('UNAUTHENTICATED');
    });

    it('evaluates ONBOARDING_REQUIRED when vehicle/bank details are missing', () => {
      const profile: CaptainProfile = {
        captainId: 'cap-1',
        mobile: '9876543210',
        status: 'ONBOARDING',
        approved: false,
        online: false,
        busy: false,
      };
      expect(computeCaptainState(true, profile, false)).toBe('ONBOARDING_REQUIRED');
    });

    it('evaluates PENDING_APPROVAL when submitted but not approved', () => {
      const profile: CaptainProfile = {
        captainId: 'cap-1',
        mobile: '9876543210',
        status: 'UNDER_REVIEW',
        approved: false,
        online: false,
        busy: false,
        vehicle: { type: 'BIKE', verified: true },
        bank: { verified: true },
      };
      expect(computeCaptainState(true, profile, false)).toBe('PENDING_APPROVAL');
    });

    it('evaluates APPROVED_OFFLINE when approved but offline', () => {
      const profile: CaptainProfile = {
        captainId: 'cap-1',
        mobile: '9876543210',
        status: 'ACTIVE',
        approved: true,
        online: false,
        busy: false,
        vehicle: { type: 'BIKE', verified: true },
        bank: { verified: true },
      };
      expect(computeCaptainState(true, profile, false)).toBe('APPROVED_OFFLINE');
    });

    it('evaluates APPROVED_ONLINE when approved and online', () => {
      const profile: CaptainProfile = {
        captainId: 'cap-1',
        mobile: '9876543210',
        status: 'ACTIVE',
        approved: true,
        online: true,
        busy: false,
        vehicle: { type: 'BIKE', verified: true },
        bank: { verified: true },
      };
      expect(computeCaptainState(true, profile, false)).toBe('APPROVED_ONLINE');
    });

    it('evaluates BUSY when carrying active delivery', () => {
      const profile: CaptainProfile = {
        captainId: 'cap-1',
        mobile: '9876543210',
        status: 'ACTIVE',
        approved: true,
        online: true,
        busy: true,
        vehicle: { type: 'BIKE', verified: true },
        bank: { verified: true },
      };
      expect(computeCaptainState(true, profile, true)).toBe('BUSY');
    });
  });
});
