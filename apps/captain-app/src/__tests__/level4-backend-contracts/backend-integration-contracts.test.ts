import { DispatchRepository } from '../../repositories/dispatch-repository';
import { DeliveryRepository } from '../../repositories/delivery-repository';
import { AvailabilityRepository } from '../../repositories/availability-repository';
import { commandStore } from '../../sync/command-store';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';
import { AppError } from '../../domain/result';
import { canTransitionDelivery } from '../../domain/delivery';

describe('Level 4: Backend Integration Contracts (TypeScript Adversarial Verification)', () => {
  let dispatchRepo: DispatchRepository;
  let deliveryRepo: DeliveryRepository;
  let availabilityRepo: AvailabilityRepository;

  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await commandStore.clear();
    setRuntimeAccessTokenForTesting('captain-a-jwt');
    dispatchRepo = new DispatchRepository();
    deliveryRepo = new DeliveryRepository();
    availabilityRepo = new AvailabilityRepository();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('1. Isolation & Access Control Contracts', () => {
    it('Foreign Captain cannot accept another Captain offer (404/403 fails closed)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          code: 'RESOURCE_NOT_FOUND',
          message: 'The requested offer is unavailable for this captain.',
        }),
      });

      const outcome = await dispatchRepo.respondToOffer('foreign-offer-999', 'ACCEPT');
      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.kind).toBe('ResourceNotFound');
        expect(outcome.error.status).toBe(404);
      }
    });

    it('Foreign Captain cannot pick up or deliver another Captain job', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          code: 'RESOURCE_NOT_FOUND',
          message: 'The delivery job is not assigned to you.',
        }),
      });

      const outcome = await deliveryRepo.markPickedUp('foreign-job-888');
      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.kind).toBe('ResourceNotFound');
      }
    });

    it('Suspended Captain cannot operate or go online (403 Forbidden)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          code: 'CAPTAIN_SUSPENDED',
          message: 'Captain account is suspended by safety and compliance.',
        }),
      });

      const outcome = await availabilityRepo.updateAvailability({
        online: true,
        latitude: 13.6288,
        longitude: 79.4192,
      });

      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.kind).toBe('AuthorizationDenied');
        expect(outcome.error.status).toBe(403);
      }
    });
  });

  describe('2. Offer Race Conditions & Idempotency', () => {
    it('Offer race condition: losing captain receives 409 Conflict', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          code: 'OFFER_ALREADY_CLAIMED',
          message: 'This offer was accepted by another captain.',
        }),
      });

      const outcome = await dispatchRepo.respondToOffer('race-offer-001', 'ACCEPT');
      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.kind).toBe('Conflict');
        expect(outcome.error.status).toBe(409);
      }
    });

    it('Pickup mutation is idempotent on server replay', async () => {
      const serverResponse = {
        id: 'job-authoritative-101',
        orderId: 'order-101',
        outletId: 'out-01',
        status: 'PICKED_UP',
        pickedUpAt: '2026-08-23T12:05:00Z',
      };

      // 1st Call
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => serverResponse,
      });

      const outcome1 = await deliveryRepo.markPickedUp('job-authoritative-101');
      expect(outcome1.outcome).toBe('ACKNOWLEDGED');

      // 2nd Call (Replay)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => serverResponse,
      });

      const outcome2 = await deliveryRepo.markPickedUp('job-authoritative-101');
      expect(outcome2.outcome).toBe('ACKNOWLEDGED');
      if (outcome1.outcome === 'ACKNOWLEDGED' && outcome2.outcome === 'ACKNOWLEDGED') {
        expect(outcome1.data.state).toBe('PICKED_UP');
        expect(outcome2.data.state).toBe('PICKED_UP');
      }
    });

    it('Delivery mutation is idempotent on server replay', async () => {
      const serverResponse = {
        id: 'job-authoritative-101',
        orderId: 'order-101',
        outletId: 'out-01',
        status: 'DELIVERED',
        deliveredAt: '2026-08-23T12:20:00Z',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => serverResponse,
      });

      const outcome1 = await deliveryRepo.markDelivered('job-authoritative-101');
      expect(outcome1.outcome).toBe('ACKNOWLEDGED');

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => serverResponse,
      });

      const outcome2 = await deliveryRepo.markDelivered('job-authoritative-101');
      expect(outcome2.outcome).toBe('ACKNOWLEDGED');
    });

    it('State transitions cannot skip illegally (ASSIGNED directly to DELIVERED is forbidden)', () => {
      expect(canTransitionDelivery('ASSIGNED', 'DELIVERED')).toBe(false);
      expect(canTransitionDelivery('ASSIGNED', 'DELIVERY_CONFIRMING')).toBe(false);
    });
  });
});
