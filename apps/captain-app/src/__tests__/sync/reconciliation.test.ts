import { commandStore } from '../../sync/command-store';
import { reconciliationService } from '../../sync/reconciliation';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { dispatchRepository } from '../../repositories/dispatch-repository';
import { availabilityRepository } from '../../repositories/availability-repository';
import { MutationCommand } from '../../domain/command';
import { DeliveryJob } from '../../domain/delivery';
import { AppError, err, ok } from '../../domain/result';
import { connectivity } from '../../sync/connectivity';

describe('ReconciliationService & Authoritative Command Reconciliation', () => {
  beforeEach(async () => {
    commandStore.resetStorageDriverForTesting();
    await commandStore.clear();
    jest.restoreAllMocks();
    connectivity.setConnected(true);
  });

  it('1. UNKNOWN delivery + activeDelivery null remains UNKNOWN (no positive mutation from absence)', async () => {
    const cmdId = 'cmd-deliv-unknown-01';
    const idempKey = 'idemp-deliv-unknown-01';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-999',
      jobId: 'job-999',
      idempotencyKey: idempKey,
      payload: { jobId: 'job-999' },
      payloadFingerprint: 'fp-deliv-999',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    // Mock activeDelivery as null, and getDispatchJob returns ResourceNotFound (404)
    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(null));
    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      err(AppError.fromHttp(404, { code: 'RESOURCE_NOT_FOUND', message: 'Job unavailable' })),
    );

    await reconciliationService.reconcile();

    // CRITICAL: Command MUST remain UNKNOWN. It must NEVER become ACKNOWLEDGED!
    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('UNKNOWN');
  });

  it('2. UNKNOWN delivery + GET job says DELIVERED => ACKNOWLEDGED', async () => {
    const cmdId = 'cmd-deliv-confirmed-02';
    const idempKey = 'idemp-deliv-confirmed-02';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-102',
      jobId: 'job-102',
      idempotencyKey: idempKey,
      payload: { jobId: 'job-102' },
      payloadFingerprint: 'fp-deliv-102',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-102',
        orderId: 'ord-102',
        outletId: 'out-1',
        status: 'DELIVERED',
        deliveredAt: '2026-08-23T11:00:00.000Z',
      }),
    );

    await reconciliationService.reconcile();

    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('ACKNOWLEDGED');
  });

  it('3. UNKNOWN delivery + GET job says PICKED_UP => retry same command/key', async () => {
    const cmdId = 'cmd-deliv-retry-03';
    const idempKey = 'idemp-deliv-retry-03';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-103',
      jobId: 'job-103',
      idempotencyKey: idempKey,
      payload: { jobId: 'job-103' },
      payloadFingerprint: 'fp-deliv-103',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-103',
        orderId: 'ord-103',
        outletId: 'out-1',
        status: 'PICKED_UP',
      }),
    );

    let retriedKey = '';
    let retriedCommandId = '';
    jest.spyOn(deliveryRepository, 'markDelivered').mockImplementation(async (_jobId, _proof, existingCmdId, existingKey) => {
      retriedCommandId = existingCmdId || '';
      retriedKey = existingKey || '';
      return {
        outcome: 'ACKNOWLEDGED',
        commandId: cmdId,
        idempotencyKey: idempKey,
        data: { state: 'DELIVERED' },
      };
    });

    await reconciliationService.reconcile();

    expect(retriedCommandId).toBe(cmdId);
    expect(retriedKey).toBe(idempKey);
  });

  it('4. UNKNOWN delivery + network failure during reconciliation => remains UNKNOWN', async () => {
    const cmdId = 'cmd-deliv-netfail-04';
    const idempKey = 'idemp-deliv-netfail-04';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-104',
      jobId: 'job-104',
      idempotencyKey: idempKey,
      payload: { jobId: 'job-104' },
      payloadFingerprint: 'fp-deliv-104',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      err(AppError.network('Network request timeout during reconciliation')),
    );

    await reconciliationService.reconcile();

    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('UNKNOWN');
  });

  it('5. Foreign job lookup fails closed', async () => {
    const cmdId = 'cmd-deliv-foreign-05';
    const idempKey = 'idemp-deliv-foreign-05';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-foreign',
      jobId: 'job-foreign',
      idempotencyKey: idempKey,
      payload: { jobId: 'job-foreign' },
      payloadFingerprint: 'fp-foreign',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    // Foreign job returns 404 anti-enumeration
    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      err(AppError.fromHttp(404, { code: 'RESOURCE_NOT_FOUND', message: 'Resource unavailable' })),
    );

    await reconciliationService.reconcile();

    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('UNKNOWN');
  });

  it('6. UNKNOWN pickup + server says DELIVERED => ACKNOWLEDGED', async () => {
    const cmdId = 'cmd-pickup-deliv-06';
    const idempKey = 'idemp-pickup-deliv-06';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-106',
      jobId: 'job-106',
      idempotencyKey: idempKey,
      payload: { jobId: 'job-106' },
      payloadFingerprint: 'fp-pickup-106',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-106',
        orderId: 'ord-106',
        outletId: 'out-1',
        status: 'DELIVERED',
        pickedUpAt: '2026-08-23T10:00:00.000Z',
        deliveredAt: '2026-08-23T10:30:00.000Z',
      }),
    );

    await reconciliationService.reconcile();

    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('ACKNOWLEDGED');
  });

  it('7. UNKNOWN accept + server assignment to same captain => ACKNOWLEDGED', async () => {
    const cmdId = 'cmd-accept-07';
    const idempKey = 'idemp-accept-07';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      resourceType: 'DISPATCH_OFFER',
      resourceId: 'offer-107',
      jobId: 'job-107',
      idempotencyKey: idempKey,
      payload: { offerId: 'offer-107', action: 'ACCEPT', jobId: 'job-107' },
      payloadFingerprint: 'fp-accept-107',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    const mockServerJob: DeliveryJob = {
      jobId: 'job-107',
      orderId: 'ord-107',
      outletId: 'out-1',
      outletName: 'Pet Store',
      originLatitude: 12.97,
      originLongitude: 77.59,
      deliveryAddress: {
        addressId: 'addr-107',
        recipientName: 'Karan',
        phoneNumber: '9876543210',
        line1: 'Koramangala',
        city: 'Bengaluru',
        state: 'KA',
        pincode: '560034',
      },
      state: 'ASSIGNED',
      earningPaise: 5000,
      assignedAt: '2026-08-23T10:00:00.000Z',
    };

    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(mockServerJob));

    await reconciliationService.reconcile();

    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('ACKNOWLEDGED');
  });

  it('8. UNKNOWN accept + offer expired/unavailable with no assignment => deterministic rejection', async () => {
    const cmdId = 'cmd-accept-expired-08';
    const idempKey = 'idemp-accept-expired-08';

    const savedCommand: MutationCommand = {
      commandId: cmdId,
      id: cmdId,
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      resourceType: 'DISPATCH_OFFER',
      resourceId: 'offer-expired-08',
      jobId: 'job-08',
      idempotencyKey: idempKey,
      payload: { offerId: 'offer-expired-08', action: 'ACCEPT', jobId: 'job-08' },
      payloadFingerprint: 'fp-accept-08',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand);

    // No active delivery
    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(null));
    // No pending offers
    jest.spyOn(dispatchRepository, 'getPendingOffers').mockResolvedValue(ok([]));

    await reconciliationService.reconcile();

    const cmd = await commandStore.get(cmdId);
    expect(cmd).toBeDefined();
    expect(cmd?.state).toBe('REJECTED');
  });

  it('9. Offer reconciliation never acts on another offer', async () => {
    const cmdId1 = 'cmd-accept-offer-1';
    const savedCommand1: MutationCommand = {
      commandId: cmdId1,
      id: cmdId1,
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      resourceType: 'DISPATCH_OFFER',
      resourceId: 'offer-1',
      idempotencyKey: 'idemp-offer-1',
      payload: { offerId: 'offer-1', action: 'ACCEPT' },
      payloadFingerprint: 'fp-offer-1',
      state: 'UNKNOWN',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await commandStore.save(savedCommand1);

    // Server has pending offer-2 (NOT offer-1)
    jest.spyOn(deliveryRepository, 'getActiveDelivery').mockResolvedValue(ok(null));
    jest.spyOn(dispatchRepository, 'getPendingOffers').mockResolvedValue(
      ok([
        {
          offerId: 'offer-2',
          jobId: 'job-2',
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          state: 'PENDING',
          receivedAt: new Date().toISOString(),
        },
      ]),
    );

    let respondedOfferId = '';
    jest.spyOn(dispatchRepository, 'respondToOffer').mockImplementation(async (offerId) => {
      respondedOfferId = offerId;
      return {
        outcome: 'ACKNOWLEDGED',
        commandId: 'any',
        idempotencyKey: 'any',
        data: {} as any,
      };
    });

    await reconciliationService.reconcile();

    // Must NOT have called respondToOffer with offer-2
    expect(respondedOfferId).toBe('');
    // Offer 1 is rejected because it is not available
    const cmd1 = await commandStore.get(cmdId1);
    expect(cmd1?.state).toBe('REJECTED');
  });

  it('10. Availability supersession: ONLINE pending -> OFFLINE newer -> reconnect -> final state OFFLINE', async () => {
    const onlineCmdId = 'cmd-avail-online';
    const offlineCmdId = 'cmd-avail-offline';

    // Simulate device went offline: Captain toggled ONLINE at T0, then OFFLINE at T1
    const onlineCommand: MutationCommand = {
      commandId: onlineCmdId,
      id: onlineCmdId,
      commandType: 'UPDATE_AVAILABILITY',
      type: 'UPDATE_AVAILABILITY',
      resourceType: 'CAPTAIN_AVAILABILITY',
      resourceId: 'self',
      idempotencyKey: 'idemp-online',
      payload: { online: true, latitude: 13.62, longitude: 79.41 },
      payloadFingerprint: 'fp-online',
      state: 'PENDING',
      createdAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 0,
      updatedAt: '2026-08-23T10:00:00.000Z',
    };

    const offlineCommand: MutationCommand = {
      commandId: offlineCmdId,
      id: offlineCmdId,
      commandType: 'UPDATE_AVAILABILITY',
      type: 'UPDATE_AVAILABILITY',
      resourceType: 'CAPTAIN_AVAILABILITY',
      resourceId: 'self',
      idempotencyKey: 'idemp-offline',
      payload: { online: false },
      payloadFingerprint: 'fp-offline',
      state: 'PENDING',
      createdAt: '2026-08-23T10:01:00.000Z',
      attemptCount: 0,
      updatedAt: '2026-08-23T10:01:00.000Z',
    };

    await commandStore.save(onlineCommand);
    await commandStore.save(offlineCommand);

    const executedParams: any[] = [];
    jest.spyOn(availabilityRepository, 'updateAvailability').mockImplementation(async (params) => {
      executedParams.push(params);
      return {
        outcome: 'ACKNOWLEDGED',
        commandId: offlineCmdId,
        idempotencyKey: 'idemp-offline',
        data: { captainId: 'cap-1', approved: true, online: params.online, busy: false },
      };
    });

    await reconciliationService.reconcile();

    // Older ONLINE command must be SUPERSEDED
    const onlineResult = await commandStore.get(onlineCmdId);
    expect(onlineResult?.state).toBe('SUPERSEDED');

    // ONLY the newer OFFLINE command must have been executed against server
    expect(executedParams.length).toBe(1);
    expect(executedParams[0].online).toBe(false);
  });

  it('11. Reconciliation after process restart preserves idempotency identity', async () => {
    const originalKey = 'idemp-pickup-persisted-11';
    const originalCmdId = 'cmd-pickup-persisted-11';

    const savedCommand: MutationCommand = {
      commandId: originalCmdId,
      id: originalCmdId,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-111',
      jobId: 'job-111',
      idempotencyKey: originalKey,
      payload: { jobId: 'job-111', proof: { type: 'PHOTO', uri: 'file://proof.jpg' } },
      payloadFingerprint: 'fp-pickup-111',
      state: 'UNKNOWN',
      createdAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 1,
      updatedAt: '2026-08-23T10:00:00.000Z',
    };
    await commandStore.save(savedCommand);

    // Simulate process kill / memory reload
    commandStore.resetMemoryForTesting();

    // Server says job is still ASSIGNED (pickup not received)
    jest.spyOn(deliveryRepository, 'getDispatchJob').mockResolvedValue(
      ok({
        jobId: 'job-111',
        orderId: 'ord-111',
        outletId: 'out-1',
        status: 'ASSIGNED',
      }),
    );

    let keyUsedInRetry = '';
    let cmdIdUsedInRetry = '';
    jest.spyOn(deliveryRepository, 'markPickedUp').mockImplementation(async (_jobId, _proof, cmdId, key) => {
      cmdIdUsedInRetry = cmdId || '';
      keyUsedInRetry = key || '';
      return {
        outcome: 'ACKNOWLEDGED',
        commandId: cmdId || '',
        idempotencyKey: key || '',
        data: { state: 'PICKED_UP' },
      };
    });

    await reconciliationService.reconcile();

    // Verify exact same commandId and idempotencyKey used across process restart
    expect(cmdIdUsedInRetry).toBe(originalCmdId);
    expect(keyUsedInRetry).toBe(originalKey);
  });
});
