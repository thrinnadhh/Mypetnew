import { commandStore } from '../../sync/command-store';
import { reconciliationService } from '../../sync/reconciliation';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { MutationCommand } from '../../domain/command';
import { DeliveryJob, isDeliveryStateMoreAdvanced } from '../../domain/delivery';
import { ok } from '../../domain/result';

describe('Level 3: Durable Reconciliation & Crash Recovery Tests', () => {
  beforeEach(async () => {
    commandStore.resetStorageDriverForTesting();
    await commandStore.clear();
    jest.restoreAllMocks();
  });

  it('Crash Recovery Scenario 1: server committed pickup + client response lost + reboot -> reconciled to exactly one pickup', async () => {
    const originalKey = 'idemp-pickup-crash-recovery';
    const originalCommandId = 'cmd-pickup-crash-recovery';

    // Simulate UNKNOWN command in SQLite / Secure Storage before crash
    const savedCommand: MutationCommand = {
      commandId: originalCommandId,
      id: originalCommandId,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      captainId: 'captain-101',
      jobId: 'job-901',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-901' },
      payloadFingerprint: 'fp-pickup-901',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 1,
    };

    await commandStore.save(savedCommand);

    // Backend query returns that server state is PICKED_UP
    const mockServerJob: DeliveryJob = {
      jobId: 'job-901',
      orderId: 'ord-901',
      outletId: 'out-01',
      outletName: 'Pet Care Store',
      deliveryAddress: {
        addressId: 'addr-01',
        recipientName: 'Vikram',
        phoneNumber: '+919876543210',
        line1: '123 Main Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      state: 'PICKED_UP',
      assignedAt: '2026-08-23T09:50:00.000Z',
      pickedUpAt: '2026-08-23T10:00:05.000Z',
    };

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-901',
        orderId: 'ord-901',
        outletId: 'out-01',
        status: 'PICKED_UP',
        pickedUpAt: '2026-08-23T10:00:05.000Z',
      }),
    );

    await reconciliationService.reconcile();

    const reconciledCmd = await commandStore.get(originalCommandId);
    expect(reconciledCmd?.state).toBe('ACKNOWLEDGED');
    expect(reconciledCmd?.idempotencyKey).toBe(originalKey);

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0);
  });

  it('Crash Recovery Scenario 2: server committed delivery + client response lost + reboot -> reconciled to exactly one delivery', async () => {
    const originalKey = 'idemp-deliv-crash-recovery';
    const originalCommandId = 'cmd-deliv-crash-recovery';

    const savedCommand: MutationCommand = {
      commandId: originalCommandId,
      id: originalCommandId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      captainId: 'captain-101',
      jobId: 'job-902',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-902' },
      payloadFingerprint: 'fp-deliv-902',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:30:00.000Z',
      attemptCount: 1,
    };

    await commandStore.save(savedCommand);

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-902',
        orderId: 'ord-902',
        outletId: 'out-01',
        status: 'DELIVERED',
        deliveredAt: '2026-08-23T10:30:05.000Z',
      }),
    );

    await reconciliationService.reconcile();

    const reconciledCmd = await commandStore.get(originalCommandId);
    expect(reconciledCmd?.state).toBe('ACKNOWLEDGED');
    expect(reconciledCmd?.idempotencyKey).toBe(originalKey);

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0);
  });

  it('retries with EXACT same idempotencyKey if backend shows job still in previous state', async () => {
    const originalKey = 'idemp-pickup-retry-original';
    const originalCommandId = 'cmd-pickup-retry-original';

    const savedCommand: MutationCommand = {
      commandId: originalCommandId,
      id: originalCommandId,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      jobId: 'job-903',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-903' },
      payloadFingerprint: 'fp-pickup-903',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 1,
    };

    await commandStore.save(savedCommand);

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-903',
        orderId: 'ord-903',
        outletId: 'out-01',
        status: 'ASSIGNED',
      }),
    );

    let keyUsedInRetry = '';
    jest.spyOn(deliveryRepository, 'markPickedUp').mockImplementation(async (_jobId, _proof, _cmdId, key) => {
      keyUsedInRetry = key || '';
      return {
        outcome: 'ACKNOWLEDGED',
        commandId: originalCommandId,
        idempotencyKey: key || '',
        data: { state: 'PICKED_UP', pickedUpAt: '2026-08-23T10:05:00.000Z' },
      };
    });

    await reconciliationService.reconcile();

    expect(keyUsedInRetry).toBe(originalKey);
  });

  it('rejects stale out-of-order responses from regressing delivery state', () => {
    // Current confirmed state: DELIVERED
    // Incoming stale response from slow network: PICKED_UP
    expect(isDeliveryStateMoreAdvanced('PICKED_UP', 'DELIVERED')).toBe(false);
    expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'DELIVERED')).toBe(false);
    expect(isDeliveryStateMoreAdvanced('ASSIGNED', 'PICKED_UP')).toBe(false);
  });
});
