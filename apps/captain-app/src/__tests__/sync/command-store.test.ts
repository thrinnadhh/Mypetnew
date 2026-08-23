import { commandStore, CommandStore, COMMAND_STORE_KEY, DurableStorageDriver } from '../../sync/command-store';
import { MutationCommand } from '../../domain/command';

describe('Durable CommandStore & Mutation Journal', () => {
  beforeEach(async () => {
    commandStore.resetStorageDriverForTesting();
    await commandStore.clear();
  });

  it('persists and retrieves a command by commandId and idempotencyKey', async () => {
    const cmd: MutationCommand = {
      commandId: 'cmd-test-1',
      id: 'cmd-test-1',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-999',
      captainId: 'captain-123',
      jobId: 'job-999',
      idempotencyKey: 'idemp-xyz-1',
      payload: { jobId: 'job-999' },
      payloadFingerprint: 'fp-12345678',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
      attemptCount: 0,
      lastAttemptAt: null,
      lastErrorCode: null,
      updatedAt: new Date().toISOString(),
    };

    await commandStore.save(cmd);

    const retrieved = await commandStore.get('cmd-test-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.commandId).toBe('cmd-test-1');
    expect(retrieved?.idempotencyKey).toBe('idemp-xyz-1');
    expect(retrieved?.resourceType).toBe('DELIVERY_JOB');
    expect(retrieved?.resourceId).toBe('job-999');
    expect(retrieved?.captainId).toBe('captain-123');
    expect(retrieved?.jobId).toBe('job-999');
    expect(retrieved?.payloadFingerprint).toBe('fp-12345678');

    const byKey = await commandStore.getByIdempotencyKey('idemp-xyz-1');
    expect(byKey).toBeDefined();
    expect(byKey?.commandId).toBe('cmd-test-1');
  });

  it('Requirement 2: Process restart reloads PENDING command', async () => {
    const pendingCmd: MutationCommand = {
      commandId: 'cmd-pending-reboot',
      id: 'cmd-pending-reboot',
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      resourceType: 'DISPATCH_OFFER',
      resourceId: 'offer-boot-01',
      idempotencyKey: 'idemp-pending-01',
      payload: { offerId: 'offer-boot-01' },
      payloadFingerprint: 'fp-offer-01',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
      attemptCount: 0,
      updatedAt: new Date().toISOString(),
    };

    await commandStore.save(pendingCmd);

    // Simulate process death / restart: reset memory cache
    commandStore.resetMemoryForTesting();

    const reloaded = await commandStore.get('cmd-pending-reboot');
    expect(reloaded).toBeDefined();
    expect(reloaded?.state).toBe('PENDING');
    expect(reloaded?.resourceId).toBe('offer-boot-01');

    const pendingList = await commandStore.listPending();
    expect(pendingList.some((c) => c.commandId === 'cmd-pending-reboot')).toBe(true);
  });

  it('Requirement 3: Process restart reloads UNKNOWN command', async () => {
    const unknownCmd: MutationCommand = {
      commandId: 'cmd-unknown-reboot',
      id: 'cmd-unknown-reboot',
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-unknown-01',
      jobId: 'job-unknown-01',
      idempotencyKey: 'idemp-unknown-01',
      payload: { jobId: 'job-unknown-01' },
      payloadFingerprint: 'fp-deliv-unknown',
      createdAt: new Date().toISOString(),
      state: 'UNKNOWN',
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
      lastErrorCode: 'Timeout',
      updatedAt: new Date().toISOString(),
    };

    await commandStore.save(unknownCmd);

    // Simulate process death / restart: reset memory cache
    commandStore.resetMemoryForTesting();

    const reloaded = await commandStore.get('cmd-unknown-reboot');
    expect(reloaded).toBeDefined();
    expect(reloaded?.state).toBe('UNKNOWN');
    expect(reloaded?.lastErrorCode).toBe('Timeout');

    const pendingList = await commandStore.listPending();
    expect(pendingList.some((c) => c.commandId === 'cmd-unknown-reboot')).toBe(true);
  });

  it('Requirement 10: Command states survive application restart', async () => {
    const cmdAck: MutationCommand = {
      commandId: 'cmd-ack-01',
      id: 'cmd-ack-01',
      commandType: 'UPDATE_AVAILABILITY',
      type: 'UPDATE_AVAILABILITY',
      resourceType: 'CAPTAIN_AVAILABILITY',
      resourceId: 'capt-01',
      captainId: 'capt-01',
      idempotencyKey: 'idemp-ack-01',
      payload: { online: true },
      payloadFingerprint: 'fp-avail',
      createdAt: new Date().toISOString(),
      state: 'ACKNOWLEDGED',
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    };
    const cmdRej: MutationCommand = {
      commandId: 'cmd-rej-01',
      id: 'cmd-rej-01',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-rej-01',
      jobId: 'job-rej-01',
      idempotencyKey: 'idemp-rej-01',
      payload: { jobId: 'job-rej-01' },
      payloadFingerprint: 'fp-pickup-rej',
      createdAt: new Date().toISOString(),
      state: 'REJECTED',
      attemptCount: 1,
      lastErrorCode: 'ValidationRejected',
      updatedAt: new Date().toISOString(),
    };

    await commandStore.save(cmdAck);
    await commandStore.save(cmdRej);

    // Simulate app restart
    commandStore.resetMemoryForTesting();

    const loadedAck = await commandStore.get('cmd-ack-01');
    const loadedRej = await commandStore.get('cmd-rej-01');

    expect(loadedAck?.state).toBe('ACKNOWLEDGED');
    expect(loadedRej?.state).toBe('REJECTED');
    expect(loadedRej?.lastErrorCode).toBe('ValidationRejected');

    // Terminal states should not be in listPending()
    const pendingList = await commandStore.listPending();
    expect(pendingList.find((c) => c.commandId === 'cmd-ack-01')).toBeUndefined();
    expect(pendingList.find((c) => c.commandId === 'cmd-rej-01')).toBeUndefined();
  });

  it('Requirement 8: Old ACKNOWLEDGED command does not get returned as active command', async () => {
    const historicalAck: MutationCommand = {
      commandId: 'cmd-hist-offer',
      id: 'cmd-hist-offer',
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      resourceType: 'DISPATCH_OFFER',
      resourceId: 'offer-100',
      idempotencyKey: 'idemp-hist-100',
      payload: { offerId: 'offer-100' },
      payloadFingerprint: 'fp-offer-100',
      createdAt: '2026-08-20T10:00:00Z',
      state: 'ACKNOWLEDGED',
      attemptCount: 1,
      updatedAt: '2026-08-20T10:00:01Z',
    };

    await commandStore.save(historicalAck);

    const active = await commandStore.findActiveCommand('ACCEPT_OFFER', 'DISPATCH_OFFER', 'offer-100');
    expect(active).toBeUndefined();

    // getByJobAndType also must not return historical terminal command
    const legacyActive = await commandStore.getByJobAndType('offer-100', 'ACCEPT_OFFER');
    expect(legacyActive).toBeUndefined();
  });

  it('Requirement 9: Storage corruption does NOT silently appear as empty successful state', async () => {
    commandStore.setStorageDriver({
      async getItem() {
        return '{{CORRUPT_JSON_DATA}}';
      },
      async setItem() {},
      async removeItem() {},
      async clear() {},
    });

    await expect(commandStore.load()).rejects.toThrow(/STORAGE_CORRUPTION_DETECTED/);
  });

  it('Requirement 1 & Fail-Closed: Storage write failure throws and prevents silent state corruption', async () => {
    const faultyDriver: DurableStorageDriver = {
      async getItem() {
        return null;
      },
      async setItem() {
        throw new Error('EIO: Disk write failure / Storage full');
      },
      async removeItem() {},
      async clear() {},
    };

    const store = new CommandStore(faultyDriver);

    const cmd: MutationCommand = {
      commandId: 'cmd-fail-persist',
      id: 'cmd-fail-persist',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-fail',
      idempotencyKey: 'idemp-fail',
      payload: {},
      payloadFingerprint: 'fp-fail',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
      attemptCount: 0,
      updatedAt: new Date().toISOString(),
    };

    await expect(store.save(cmd)).rejects.toThrow('EIO: Disk write failure / Storage full');

    // In-memory state should not retain the uncommitted command
    const retrieved = await store.get('cmd-fail-persist');
    expect(retrieved).toBeUndefined();
  });
});
