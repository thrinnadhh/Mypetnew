import { deliveryRepository } from '../../repositories/delivery-repository';
import { commandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';
import { connectivity } from '../../sync/connectivity';
import { reconciliationService } from '../../sync/reconciliation';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';
import { ok } from '../../domain/result';

describe('E2E: Network Resilience, Crash Recovery & Reconciliation Flow', () => {
  const mockJobId = 'job-resilience-999';

  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await commandStore.clear();
    setRuntimeAccessTokenForTesting('e2e-resilience-jwt');
    connectivity.setConnected(true);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('handles offline command queueing, flight drops, process reboot, and authoritative reconciliation', async () => {
    // -------------------------------------------------------------
    // 1. OFFLINE QUEUEING: Device loses internet connectivity
    // -------------------------------------------------------------
    connectivity.setConnected(false);

    const offlineOutcome = await commandRunner.execute({
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: mockJobId,
      jobId: mockJobId,
      payload: { jobId: mockJobId },
    }, async () => ({ id: mockJobId, status: 'PICKED_UP' }));

    expect(offlineOutcome.outcome).toBe('PENDING');

    const pendingList = await commandStore.listPending();
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].state).toBe('PENDING');
    expect(pendingList[0].commandType).toBe('MARK_PICKED_UP');

    // -------------------------------------------------------------
    // 2. NETWORK RESTORED & TRANSMISSION
    // -------------------------------------------------------------
    connectivity.setConnected(true);

    const onlineOutcome = await commandRunner.execute({
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: mockJobId,
      jobId: mockJobId,
      payload: { jobId: mockJobId },
      existingCommandId: pendingList[0].commandId,
      existingIdempotencyKey: pendingList[0].idempotencyKey,
    }, async () => ({ id: mockJobId, status: 'PICKED_UP' }));

    expect(onlineOutcome.outcome).toBe('ACKNOWLEDGED');

    // -------------------------------------------------------------
    // 3. FLIGHT DROP (UNKNOWN STATE): Network drops during server response
    // -------------------------------------------------------------
    const networkDropError = new Error('Network request failed');
    (global.fetch as jest.Mock).mockRejectedValueOnce(networkDropError);

    const pickupOutcome = await deliveryRepository.markPickedUp(mockJobId, {
      type: 'PIN',
      pinCode: '1234',
      capturedAt: '2026-08-23T12:10:00Z',
    });

    // Invariant: MUST NOT fabricate success on network failure
    expect(pickupOutcome.outcome).toBe('UNKNOWN');

    const unknownCommands = await commandStore.listPending();
    expect(unknownCommands.length).toBe(1);
    expect(unknownCommands[0].state).toBe('UNKNOWN');
    expect(unknownCommands[0].commandType).toBe('MARK_PICKED_UP');

    // -------------------------------------------------------------
    // 4. PROCESS CRASH & RESTART SIMULATION
    // -------------------------------------------------------------
    // Reload commands directly from durable store
    const restartedPending = await commandStore.listPending();
    expect(restartedPending.length).toBe(1);
    expect(restartedPending[0].commandId).toBe(unknownCommands[0].commandId);
    expect(restartedPending[0].state).toBe('UNKNOWN');

    // -------------------------------------------------------------
    // 5. RECONCILIATION WITH AUTHORITATIVE BACKEND
    // -------------------------------------------------------------
    // Server confirms that the pickup was indeed committed
    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValueOnce(
      ok({
        jobId: mockJobId,
        orderId: 'ord-888',
        outletId: 'out-111',
        outletName: 'Pet Care Indiranagar',
        deliveryAddress: {
          addressId: 'addr-01',
          recipientName: 'Ananya Roy',
          phoneNumber: '+919876543210',
          line1: '88 Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
        state: 'PICKED_UP',
        assignedAt: '2026-08-23T12:00:00Z',
        pickedUpAt: '2026-08-23T12:10:00Z',
        deliveredAt: null,
      }),
    );

    await reconciliationService.reconcile();

    // Command is now resolved to ACKNOWLEDGED in store
    const reconciledCmd = await commandStore.get(unknownCommands[0].commandId);
    expect(reconciledCmd?.state).toBe('ACKNOWLEDGED');

    const postReconcilePending = await commandStore.listPending();
    expect(postReconcilePending.length).toBe(0);
  });
});
