import { CommandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';
import { DispatchRepository } from '../../repositories/dispatch-repository';
import { DeliveryRepository } from '../../repositories/delivery-repository';
import { AppError } from '../../domain/result';

describe('Server-Authoritative Contract Tests', () => {
  beforeEach(async () => {
    await commandStore.clear();
    jest.restoreAllMocks();
  });

  describe('Dispatch Offer Acceptance', () => {
    it('MUST NEVER fabricate assignment when network fails during offer acceptance', async () => {
      const repository = new DispatchRepository();

      // Mock network fetch throwing Network Error
      global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      const outcome = await repository.respondToOffer('offer-123', 'ACCEPT');

      // 1. Outcome must be UNKNOWN, NOT ACKNOWLEDGED
      expect(outcome.outcome).toBe('UNKNOWN');
      if (outcome.outcome === 'UNKNOWN') {
        expect(outcome.error.kind).toBe('NetworkUnavailable');
        expect(outcome.idempotencyKey).toBeDefined();
      }

      // 2. Command must be durably stored as UNKNOWN for reconciliation
      const pending = await commandStore.listPending();
      expect(pending.length).toBe(1);
      expect(pending[0].state).toBe('UNKNOWN');
      expect(pending[0].type).toBe('ACCEPT_OFFER');
    });

    it('MUST reject and not accept when backend returns 409 Conflict', async () => {
      const repository = new DispatchRepository();

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: { get: () => 'trace-409' },
        json: async () => ({
          error: {
            code: 'OFFER_ALREADY_CLAIMED',
            message: 'This offer was accepted by another captain.',
          },
        }),
      });

      const outcome = await repository.respondToOffer('offer-123', 'ACCEPT');

      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.kind).toBe('Conflict');
        expect(outcome.error.message).toContain('another captain');
      }

      const pending = await commandStore.listPending();
      expect(pending.length).toBe(0); // REJECTED is not pending retry
    });

    it('MUST establish assignment ONLY when backend returns 200 OK with valid assignment payload', async () => {
      const repository = new DispatchRepository();

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'trace-200' },
        json: async () => ({
          accepted: true,
          jobId: 'job-authoritative-99',
          orderId: 'ord-777',
          outletId: 'out-111',
          outletName: 'Paw Store Koramangala',
          deliveryAddress: {
            addressId: 'addr-55',
            recipientName: 'Vikram Sharma',
            phoneNumber: '+919876543210',
            line1: '12th Main Road, 4th Block',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560034',
          },
        }),
      });

      const outcome = await repository.respondToOffer('offer-123', 'ACCEPT');

      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.accepted).toBe(true);
        expect(outcome.data.jobId).toBe('job-authoritative-99');
        expect(outcome.data.deliveryAddress.recipientName).toBe('Vikram Sharma');
      }
    });
  });

  describe('Pickup Lifecycle Verification', () => {
    it('MUST NEVER transition to PICKED_UP on network timeout', async () => {
      const repository = new DeliveryRepository();

      // Simulate timeout
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      global.fetch = jest.fn().mockRejectedValue(abortError);

      const outcome = await repository.markPickedUp('job-99', {
        type: 'PIN',
        pinCode: '4321',
        capturedAt: new Date().toISOString(),
      });

      // Outcome MUST be UNKNOWN
      expect(outcome.outcome).toBe('UNKNOWN');
      if (outcome.outcome === 'UNKNOWN') {
        expect(outcome.error.kind).toBe('Timeout');
      }

      // Check command runner logged command for reconciliation
      const pending = await commandStore.listPending();
      expect(pending.length).toBe(1);
      expect(pending[0].state).toBe('UNKNOWN');
    });

    it('MUST transition to PICKED_UP only when backend confirms with 200 OK', async () => {
      const repository = new DeliveryRepository();

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'trace-pickup' },
        json: async () => ({
          id: 'job-99',
          orderId: 'ord-777',
          outletId: 'out-111',
          originLatitude: 12.9716,
          originLongitude: 77.5946,
          status: 'PICKED_UP',
          pickedUpAt: '2026-08-23T10:00:00Z',
        }),
      });

      const outcome = await repository.markPickedUp('job-99');

      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.state).toBe('PICKED_UP');
        expect(outcome.data.pickedUpAt).toBe('2026-08-23T10:00:00Z');
      }
    });
  });

  describe('Delivery Completion Lifecycle', () => {
    it('MUST NEVER transition to DELIVERED when backend returns 500 error', async () => {
      const repository = new DeliveryRepository();

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => 'trace-500' },
        json: async () => ({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Database connection failed during delivery commit',
          },
        }),
      });

      const outcome = await repository.markDelivered('job-99');

      expect(outcome.outcome).toBe('UNKNOWN');
      if (outcome.outcome === 'UNKNOWN') {
        expect(outcome.error.kind).toBe('ServerFailure');
      }
    });

    it('MUST transition to DELIVERED only when backend confirms with 200 OK', async () => {
      const repository = new DeliveryRepository();

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'trace-deliv' },
        json: async () => ({
          id: 'job-99',
          orderId: 'ord-777',
          outletId: 'out-111',
          originLatitude: 12.9716,
          originLongitude: 77.5946,
          status: 'DELIVERED',
          deliveredAt: '2026-08-23T10:30:00Z',
        }),
      });

      const outcome = await repository.markDelivered('job-99');

      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.state).toBe('DELIVERED');
        expect(outcome.data.deliveredAt).toBe('2026-08-23T10:30:00Z');
      }
    });
  });
});
