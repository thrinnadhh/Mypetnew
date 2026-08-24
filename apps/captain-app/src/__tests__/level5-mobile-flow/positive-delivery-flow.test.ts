import {
  fetchPendingOffers,
  markJobDelivered,
  markJobPickedUp,
  respondToOffer,
} from '../../api/dispatch';
import { updateCaptainAvailability } from '../../api/availability';
import { fetchCaptainProfile } from '../../api/captain';
import { setRuntimeAccessTokenForTesting, storeSession, clearSession } from '../../auth/session';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { dispatchRepository } from '../../repositories/dispatch-repository';
import { commandStore } from '../../sync/command-store';
import { reconciliationService } from '../../sync/reconciliation';
import { formatPaise } from '../../utils/money';
import { ok } from '../../domain/result';

describe('Level 5: Positive End-to-End Mobile Delivery Flow', () => {
  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await clearSession();
    await commandStore.clear();
    setRuntimeAccessTokenForTesting('e2e-approved-captain-token');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('executes full end-to-end delivery flow: login -> approved -> location -> online -> offer -> accept -> pickup -> delivery -> completion with reconciliation', async () => {
    // 1. Authenticate & Verify Captain Approval
    await storeSession({
      accountId: 'captain-e2e-001',
      accessToken: 'e2e-approved-captain-token',
      refreshToken: 'e2e-approved-refresh-token',
      accessTokenExpiresAt: '2026-08-23T15:00:00Z',
      refreshTokenExpiresAt: '2026-09-23T15:00:00Z',
      role: 'CAPTAIN',
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: 'captain-e2e-001',
        name: 'Karthik Raja',
        mobile: '+919876543210',
        status: 'ACTIVE',
        approved: true,
        online: false,
        busy: false,
      }),
    });

    const profile = await fetchCaptainProfile();
    expect(profile.status).toBe('ACTIVE');
    expect(profile.approved).toBe(true);

    // 2. Grant GPS Location & Go Online
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: 'captain-e2e-001',
        approved: true,
        online: true,
        busy: false,
        lastLocationAt: '2026-08-23T12:00:00Z',
      }),
    });

    const presence = await updateCaptainAvailability({
      online: true,
      latitude: 13.6288,
      longitude: 79.4192,
      accuracy: 10,
    });
    expect(presence.online).toBe(true);

    // 3. Receive Nearby Dispatch Offer
    const mockOfferPayload = [
      {
        offerId: 'offer-e2e-777',
        jobId: 'job-e2e-999',
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        outletName: 'Pet Care Store Koramangala',
        area: 'Koramangala 4th Block',
        distanceMeters: 1200,
        itemCount: 2,
        estimatedEarningPaise: 8000,
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockOfferPayload,
    });

    const pendingOffers = await fetchPendingOffers();
    expect(pendingOffers).toHaveLength(1);
    expect(pendingOffers[0].offerId).toBe('offer-e2e-777');
    expect(formatPaise(pendingOffers[0].estimatedEarningPaise)).toBe('₹80');

    // 4. Accept Delivery Offer & Lock Assignment
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        jobId: 'job-e2e-999',
        orderId: 'ord-e2e-111',
        outletId: 'out-01',
        outletName: 'Pet Care Store Koramangala',
        deliveryAddress: {
          addressId: 'addr-01',
          recipientName: 'Deepak Sharma',
          phoneNumber: '+919876543210',
          line1: '123 Koramangala 4th Block',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560034',
        },
      }),
    });

    const assignment = await respondToOffer('offer-e2e-777', 'ACCEPT');
    expect(assignment.accepted).toBe(true);
    expect(assignment.jobId).toBe('job-e2e-999');
    expect(assignment.deliveryAddress?.recipientName).toBe('Deepak Sharma');

    // 5. Navigate to Pickup & Confirm Pickup (with server acknowledgment)
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-e2e-999',
        orderId: 'ord-e2e-111',
        outletId: 'out-01',
        status: 'PICKED_UP',
        pickedUpAt: '2026-08-23T12:05:00Z',
      }),
    });

    const pickupOutcome = await deliveryRepository.markPickedUp('job-e2e-999', {
      type: 'PIN',
      pinCode: '1234',
      capturedAt: '2026-08-23T12:05:00Z',
    });

    expect(pickupOutcome.outcome).toBe('ACKNOWLEDGED');
    if (pickupOutcome.outcome === 'ACKNOWLEDGED') {
      expect(pickupOutcome.data.state).toBe('PICKED_UP');
    }

    // 6. Navigate to Customer & Complete Delivery with injected network timeout after server commit + reconciliation
    // First attempt: Server receives and commits delivery, but connection drops on response flight
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);

    const delivAttemptOutcome = await deliveryRepository.markDelivered('job-e2e-999', {
      type: 'PIN',
      pinCode: '5678',
      capturedAt: '2026-08-23T12:20:00Z',
    });

    // Client MUST NOT fabricate successful state on timeout
    expect(delivAttemptOutcome.outcome).toBe('UNKNOWN');

    // Verify command saved in durable store as UNKNOWN
    const pendingCommands = await commandStore.listPending();
    expect(pendingCommands.length).toBe(1);
    expect(pendingCommands[0].state).toBe('UNKNOWN');

    // 7. Reconciliation Service runs: Server confirms job is DELIVERED
    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValueOnce(
      ok({
        jobId: 'job-e2e-999',
        orderId: 'ord-e2e-111',
        outletId: 'out-01',
        outletName: 'Pet Care Store Koramangala',
        deliveryAddress: {
          addressId: 'addr-01',
          recipientName: 'Deepak Sharma',
          phoneNumber: '+919876543210',
          line1: '123 Koramangala 4th Block',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560034',
        },
        state: 'DELIVERED',
        assignedAt: '2026-08-23T12:00:00Z',
        pickedUpAt: '2026-08-23T12:05:00Z',
        deliveredAt: '2026-08-23T12:20:00Z',
      }),
    );

    await reconciliationService.reconcile();

    // 8. Durable store is now reconciled to ACKNOWLEDGED with zero duplicate mutations
    const reconciled = await commandStore.get(pendingCommands[0].commandId);
    expect(reconciled?.state).toBe('ACKNOWLEDGED');

    const remainingPending = await commandStore.listPending();
    expect(remainingPending.length).toBe(0);
  });
});
