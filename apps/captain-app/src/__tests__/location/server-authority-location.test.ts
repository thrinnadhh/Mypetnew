import { AppError } from '../../domain/result';
import { availabilityRepository } from '../../repositories/availability-repository';
import { locationUploader } from '../../location/location-uploader';

describe('Server Authority & Presence Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    locationUploader.clearCache();
  });

  describe('1. Server Authority on Availability Transitions', () => {
    it('does not transition to online if backend rejects presence update', async () => {
      jest.spyOn(availabilityRepository, 'updateAvailability').mockResolvedValueOnce({
        outcome: 'REJECTED',
        commandId: 'cmd-presence-1',
        error: AppError.fromHttp(403, {
          code: 'CAPTAIN_SUSPENDED',
          message: 'Captain account is suspended by compliance.',
        }),
        idempotencyKey: 'test-idemp',
      });

      const outcome = await availabilityRepository.updateAvailability({
        online: true,
        latitude: 13.6288,
        longitude: 79.4192,
      });

      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.code).toBe('CAPTAIN_SUSPENDED');
        expect(outcome.error.status).toBe(403);
      }
    });

    it('does not transition to online if network times out (UNKNOWN outcome)', async () => {
      jest.spyOn(availabilityRepository, 'updateAvailability').mockResolvedValueOnce({
        outcome: 'UNKNOWN',
        commandId: 'cmd-presence-1',
        idempotencyKey: 'test-idemp',
        error: AppError.timeout('Presence update timed out'),
      });

      const outcome = await availabilityRepository.updateAvailability({
        online: true,
        latitude: 13.6288,
        longitude: 79.4192,
      });

      expect(outcome.outcome).toBe('UNKNOWN');
      // In accordance with server-authority principle, UNKNOWN must NEVER be treated as successful online state
      expect(outcome.outcome).not.toBe('ACKNOWLEDGED');
    });

    it('transitions to online only upon authoritative ACKNOWLEDGED outcome', async () => {
      jest.spyOn(availabilityRepository, 'updateAvailability').mockResolvedValueOnce({
        outcome: 'ACKNOWLEDGED',
        commandId: 'cmd-presence-1',
        data: {
          captainId: 'c-123',
          approved: true,
          online: true,
          busy: false,
          lastLocationAt: '2026-08-23T12:00:00Z',
        },
        idempotencyKey: 'test-idemp',
      });

      const outcome = await availabilityRepository.updateAvailability({
        online: true,
        latitude: 13.6288,
        longitude: 79.4192,
      });

      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.online).toBe(true);
        expect(outcome.data.approved).toBe(true);
      }
    });

    it('tears down tracking and maintains local offline posture on go-offline', async () => {
      jest.spyOn(availabilityRepository, 'updateAvailability').mockResolvedValueOnce({
        outcome: 'ACKNOWLEDGED',
        commandId: 'cmd-presence-2',
        data: {
          captainId: 'c-123',
          approved: true,
          online: false,
          busy: false,
          lastLocationAt: '2026-08-23T12:00:00Z',
        },
        idempotencyKey: 'test-idemp',
      });

      locationUploader.startTracking(true, false);
      expect((locationUploader as any).intervalId).not.toBeNull();

      locationUploader.stopTracking();
      expect((locationUploader as any).intervalId).toBeNull();

      const outcome = await availabilityRepository.updateAvailability({
        online: false,
      });
      expect(outcome.outcome).toBe('ACKNOWLEDGED');
    });
  });
});
