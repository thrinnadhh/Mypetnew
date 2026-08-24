import {
  fetchDispatchJob,
  fetchPendingOffers,
  respondToOffer,
} from '../../api/dispatch';
import { createSupportTicket } from '../../api/support';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';
import { commandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';

describe('E2E: Multi-Captain Concurrency, Isolation & Security Boundary Flow', () => {
  const offerId = 'offer-race-888';
  const jobId = 'job-race-555';

  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await commandStore.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('handles multi-captain offer race, foreign job isolation, and idempotency tampering', async () => {
    // -------------------------------------------------------------
    // 1. CONCURRENT OFFER RACE: Two captains attempt to accept same offer
    // -------------------------------------------------------------
    // Captain A session
    setRuntimeAccessTokenForTesting('captain-a-jwt', 'captain-a');

    // Captain A wins race (200 OK)
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        jobId,
        orderId: 'ord-race-111',
        outletId: 'out-01',
        outletName: 'Pet Care Store',
        deliveryAddress: {
          addressId: 'addr-01',
          recipientName: 'Customer Alpha',
          phoneNumber: '+919988776655',
          line1: '100 Main St',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      }),
    });

    const captainAClaim = await respondToOffer(offerId, 'ACCEPT');
    expect(captainAClaim.accepted).toBe(true);
    expect(captainAClaim.jobId).toBe(jobId);

    // Captain B session tries to claim the same offer
    setRuntimeAccessTokenForTesting('captain-b-jwt', 'captain-b');

    // Server returns 409 Conflict (Offer already claimed by Captain A)
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'DISPATCH_CONFLICT',
        message: 'Offer has already been claimed by another captain or expired',
      }),
    });

    await expect(respondToOffer(offerId, 'ACCEPT')).rejects.toThrow();

    // -------------------------------------------------------------
    // 2. FOREIGN JOB ISOLATION: Captain B tries to inspect Captain A's job
    // -------------------------------------------------------------
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        code: 'AUTHORIZATION_DENIED',
        message: 'Captain is not assigned to this delivery job',
      }),
    });

    await expect(fetchDispatchJob(jobId)).rejects.toThrow();

    // -------------------------------------------------------------
    // 3. SUPPORT TICKET CREATION: Captain A creates support ticket on active job
    // -------------------------------------------------------------
    setRuntimeAccessTokenForTesting('captain-a-jwt', 'captain-a');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ticketId: 'ticket-001',
        status: 'OPEN',
        createdAt: '2026-08-23T12:15:00Z',
      }),
    });

    const ticket = await createSupportTicket({
      category: 'ACTIVE_DELIVERY',
      subject: 'Customer unreachable at gate',
      description: 'Security guard not letting in and phone is busy',
      jobId,
    });

    expect(ticket.ticketId).toBe('ticket-001');
    expect(ticket.status).toBe('OPEN');

    // -------------------------------------------------------------
    // 4. IDEMPOTENCY KEY TAMPERING (FAIL-CLOSED)
    // -------------------------------------------------------------
    // Execute a command with an explicit idempotency key
    const existingIdempKey = 'idemp-immutable-key-999';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: jobId,
        status: 'PICKED_UP',
      }),
    });

    const initialOutcome = await commandRunner.execute({
      type: 'MARK_PICKED_UP',
      payload: { jobId, captainId: 'captain-a', note: 'Original' },
      resourceType: 'DELIVERY_JOB',
      resourceId: jobId,
      existingIdempotencyKey: existingIdempKey,
    }, async () => ({ id: jobId, status: 'PICKED_UP' }));

    expect(initialOutcome.outcome).toBe('ACKNOWLEDGED');

    // Replay with identical idempotency key but altered payload -> MUST FAIL CLOSED
    await expect(
      commandRunner.execute({
        type: 'MARK_PICKED_UP',
        payload: { jobId, captainId: 'captain-a', note: 'Altered Tampered Payload' },
        resourceType: 'DELIVERY_JOB',
        resourceId: jobId,
        existingIdempotencyKey: existingIdempKey,
      }, async () => ({ id: jobId, status: 'PICKED_UP' })),
    ).rejects.toThrow(/IDEMPOTENCY_FINGERPRINT_MISMATCH/);
  });
});
