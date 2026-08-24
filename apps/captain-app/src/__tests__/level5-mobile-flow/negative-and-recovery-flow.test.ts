import { dispatchRepository } from '../../repositories/dispatch-repository';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { commandStore } from '../../sync/command-store';
import { connectivity } from '../../sync/connectivity';
import { setRuntimeAccessTokenForTesting, clearSession } from '../../auth/session';

describe('Level 5: Negative E2E & Server Authority Guarantees', () => {
  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await clearSession();
    await commandStore.clear();
    connectivity.setConnected(true);
    setRuntimeAccessTokenForTesting('negative-e2e-token');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('negative E2E: login -> receive offer -> lose network -> tap accept -> NOT falsely accepted', async () => {
    // 1. Captain receives offer while online
    // 2. Network drops before/during accept tap
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));

    // 3. Captain taps Accept
    const outcome = await dispatchRepository.respondToOffer('offer-negative-101', 'ACCEPT');

    // 4. Assert outcome is UNKNOWN, NEVER ACKNOWLEDGED
    expect(outcome.outcome).toBe('UNKNOWN');
    expect(outcome.outcome).not.toBe('ACKNOWLEDGED');

    if (outcome.outcome === 'UNKNOWN') {
      expect(outcome.error.kind).toBe('NetworkUnavailable');
      expect(outcome.idempotencyKey).toBeDefined();
    }

    // 5. Command is saved in store for reconciliation, NEVER marked ACKNOWLEDGED
    const pending = await commandStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe('UNKNOWN');
    expect(pending[0].commandType).toBe('ACCEPT_OFFER');
  });

  it('captain never fabricates successful business state on network failure', async () => {
    // --- SECTION A: OFFER ACCEPTANCE NETWORK FAILURE ---
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Connection reset by peer'));

    const offerOutcome = await dispatchRepository.respondToOffer('offer-fail-001', 'ACCEPT');

    expect(offerOutcome.outcome).toBe('UNKNOWN');
    expect(offerOutcome.outcome).not.toBe('ACKNOWLEDGED');
    // Ensure no fake address or fake job ID is generated on failure
    if (offerOutcome.outcome === 'UNKNOWN') {
      expect(offerOutcome.error.kind).toBe('NetworkUnavailable');
    }

    // --- SECTION B: PICKUP CONFIRMATION NETWORK FAILURE ---
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'AbortError';
    (global.fetch as jest.Mock).mockRejectedValueOnce(timeoutError);

    const pickupOutcome = await deliveryRepository.markPickedUp('job-fail-002', {
      type: 'PIN',
      pinCode: '4321',
      capturedAt: new Date().toISOString(),
    });

    expect(pickupOutcome.outcome).toBe('UNKNOWN');
    expect(pickupOutcome.outcome).not.toBe('ACKNOWLEDGED');
    if (pickupOutcome.outcome === 'UNKNOWN') {
      expect(pickupOutcome.error.kind).toBe('Timeout');
    }

    // --- SECTION C: DELIVERY COMPLETION NETWORK FAILURE (500 Internal Error) ---
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: {
          code: 'DATABASE_TIMEOUT',
          message: 'Server failed to write delivery completion audit log',
        },
      }),
    });

    const deliveryOutcome = await deliveryRepository.markDelivered('job-fail-003', {
      type: 'PIN',
      pinCode: '8765',
      capturedAt: new Date().toISOString(),
    });

    expect(deliveryOutcome.outcome).toBe('UNKNOWN');
    expect(deliveryOutcome.outcome).not.toBe('ACKNOWLEDGED');
    if (deliveryOutcome.outcome === 'UNKNOWN') {
      expect(deliveryOutcome.error.kind).toBe('ServerFailure');
      expect(deliveryOutcome.error.status).toBe(500);
    }
  });

  it('offline offer response: tapping accept while offline queues PENDING and does not fabricate assignment', async () => {
    connectivity.setConnected(false);

    const outcome = await dispatchRepository.respondToOffer('offer-offline-001', 'ACCEPT');

    expect(outcome.outcome).toBe('PENDING');
    expect(outcome.outcome).not.toBe('ACKNOWLEDGED');

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe('PENDING');
  });
});
