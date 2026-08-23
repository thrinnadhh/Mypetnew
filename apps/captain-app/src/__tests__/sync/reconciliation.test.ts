import { commandStore } from '../../sync/command-store';
import { reconciliationService } from '../../sync/reconciliation';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { MutationCommand } from '../../domain/command';
import { DeliveryJob } from '../../domain/delivery';
import { ok } from '../../domain/result';

describe('ReconciliationService & Process Death Scenarios', () => {
  beforeEach(async () => {
    await commandStore.clear();
    jest.restoreAllMocks();
  });

  it('Process Death Scenario 1: server commits pickup + response lost + process restart → exactly one pickup', async () => {
    const originalKey = 'idemp-pickup-lost-response';
    const originalCommandId = 'cmd-pickup-lost-response';

    // Simulate state saved before process kill: UNKNOWN pickup command
    const savedCommand: MutationCommand = {
      commandId: originalCommandId,
      id: originalCommandId,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      captainId: 'captain-01',
      jobId: 'job-101',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-101' },
      payloadFingerprint: 'fp-pickup-101',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 1,
      lastAttemptAt: '2026-08-23T10:00:01.000Z',
    };

    await commandStore.save(savedCommand);

    // Simulate process restart: mock backend response to query job returning PICKED_UP
    const mockServerJob: DeliveryJob = {
      jobId: 'job-101',
      orderId: 'ord-101',
      outletId: 'out-1',
      outletName: 'Paw Store',
      originLatitude: 12.9716,
      originLongitude: 77.5946,
      deliveryAddress: {
        addressId: 'addr-1',
        recipientName: 'Rahul',
        phoneNumber: '9876543210',
        line1: '123 Koramangala',
        city: 'Bengaluru',
        state: 'KA',
        pincode: '560034',
      },
      state: 'PICKED_UP',
      earningPaise: 5000,
      assignedAt: '2026-08-23T09:50:00.000Z',
      pickedUpAt: '2026-08-23T10:00:02.000Z',
    };

    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(mockServerJob));

    // Run reconciliation
    await reconciliationService.reconcile();

    // Verify command was reconciled to ACKNOWLEDGED without creating a new command
    const command = await commandStore.get(originalCommandId);
    expect(command).toBeDefined();
    expect(command?.state).toBe('ACKNOWLEDGED');
    expect(command?.idempotencyKey).toBe(originalKey);

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0);

    const all = await commandStore.listAll();
    expect(all.length).toBe(1);
  });

  it('Process Death Scenario 2: server commits delivery + response lost + process restart → exactly one delivery', async () => {
    const originalKey = 'idemp-deliv-lost-response';
    const originalCommandId = 'cmd-deliv-lost-response';

    const savedCommand: MutationCommand = {
      commandId: originalCommandId,
      id: originalCommandId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      captainId: 'captain-01',
      jobId: 'job-202',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-202' },
      payloadFingerprint: 'fp-deliv-202',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:15:00.000Z',
      attemptCount: 1,
      lastAttemptAt: '2026-08-23T10:15:01.000Z',
    };

    await commandStore.save(savedCommand);

    const mockServerJob: DeliveryJob = {
      jobId: 'job-202',
      orderId: 'ord-202',
      outletId: 'out-1',
      outletName: 'Paw Store',
      originLatitude: 12.9716,
      originLongitude: 77.5946,
      deliveryAddress: {
        addressId: 'addr-2',
        recipientName: 'Anita',
        phoneNumber: '9876543211',
        line1: '456 Indiranagar',
        city: 'Bengaluru',
        state: 'KA',
        pincode: '560038',
      },
      state: 'DELIVERED',
      earningPaise: 6000,
      assignedAt: '2026-08-23T09:50:00.000Z',
      pickedUpAt: '2026-08-23T10:00:00.000Z',
      deliveredAt: '2026-08-23T10:15:02.000Z',
    };

    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(mockServerJob));

    await reconciliationService.reconcile();

    const command = await commandStore.get(originalCommandId);
    expect(command).toBeDefined();
    expect(command?.state).toBe('ACKNOWLEDGED');
    expect(command?.idempotencyKey).toBe(originalKey);

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0);

    const all = await commandStore.listAll();
    expect(all.length).toBe(1);
  });

  it('retries with exact same idempotencyKey if backend shows job still in previous state', async () => {
    const originalKey = 'idemp-pickup-retry-me';
    const originalCommandId = 'cmd-pickup-retry-me';

    const savedCommand: MutationCommand = {
      commandId: originalCommandId,
      id: originalCommandId,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      jobId: 'job-303',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-303' },
      payloadFingerprint: 'fp-pickup-303',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 1,
    };

    await commandStore.save(savedCommand);

    const mockServerJob: DeliveryJob = {
      jobId: 'job-303',
      orderId: 'ord-303',
      outletId: 'out-1',
      outletName: 'Paw Store',
      originLatitude: 12.9716,
      originLongitude: 77.5946,
      deliveryAddress: {
        addressId: 'addr-3',
        recipientName: 'Kavita',
        phoneNumber: '9876543212',
        line1: '789 Whitefield',
        city: 'Bengaluru',
        state: 'KA',
        pincode: '560066',
      },
      state: 'ASSIGNED', // Server did NOT commit pickup yet
      earningPaise: 5000,
      assignedAt: '2026-08-23T09:50:00.000Z',
    };

    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(mockServerJob));

    let keyReceivedInRetry = '';
    jest.spyOn(deliveryRepository, 'markPickedUp').mockImplementation(async (_jobId, _proof, _cmdId, key) => {
      keyReceivedInRetry = key || '';
      return {
        outcome: 'ACKNOWLEDGED',
        commandId: originalCommandId,
        idempotencyKey: key || '',
        data: { state: 'PICKED_UP', pickedUpAt: '2026-08-23T10:05:00.000Z' },
      };
    });

    await reconciliationService.reconcile();

    expect(keyReceivedInRetry).toBe(originalKey);
  });
});
