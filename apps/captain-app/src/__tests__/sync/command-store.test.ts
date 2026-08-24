import {
  commandStore,
  CommandStore,
  DefaultStorageDriver,
  DurableStorageDriver,
} from '../../sync/command-store';
import { MutationCommand } from '../../domain/command';
import * as SecureStore from 'expo-secure-store';

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

  it('uses a native persistent driver across fresh CommandStore instances', async () => {
    const firstProcess = new CommandStore(new DefaultStorageDriver());
    await firstProcess.clear();
    await firstProcess.save({
      commandId: 'cmd-native-restart',
      id: 'cmd-native-restart',
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      resourceType: 'DISPATCH_OFFER',
      resourceId: 'offer-native-restart',
      captainId: 'captain-native',
      idempotencyKey: 'idemp-native-restart',
      payload: { offerId: 'offer-native-restart' },
      payloadFingerprint: 'fp-native-restart',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
      attemptCount: 0,
      updatedAt: new Date().toISOString(),
    });

    const restartedProcess = new CommandStore(new DefaultStorageDriver());
    await expect(restartedProcess.get('cmd-native-restart', 'captain-native')).resolves.toMatchObject({
      state: 'PENDING',
      resourceId: 'offer-native-restart',
    });
  });

  it('keeps proof PINs out of the SQLite journal while preserving active replay identity', async () => {
    let persisted: string | null = null;
    const driver: DurableStorageDriver = {
      async getItem() {
        return persisted;
      },
      async setItem(_key, value) {
        persisted = value;
      },
      async removeItem() {
        persisted = null;
      },
      async clear() {
        persisted = null;
      },
    };
    const store = new CommandStore(driver);
    await store.save({
      commandId: 'cmd-sensitive-proof',
      id: 'cmd-sensitive-proof',
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-sensitive-proof',
      captainId: 'captain-sensitive',
      jobId: 'job-sensitive-proof',
      idempotencyKey: 'idemp-sensitive-proof',
      payload: {
        jobId: 'job-sensitive-proof',
        proof: { type: 'PIN', pinCode: '5678', capturedAt: '2026-08-24T10:00:00Z' },
      },
      payloadFingerprint: 'fp-sensitive-proof',
      createdAt: '2026-08-24T10:00:00Z',
      state: 'UNKNOWN',
      attemptCount: 1,
      updatedAt: '2026-08-24T10:00:01Z',
    });

    expect(persisted).not.toContain('5678');
    expect(persisted).toContain('requiresPinReentry');

    const restarted = new CommandStore(driver);
    const restored = await restarted.get('cmd-sensitive-proof', 'captain-sensitive');
    expect((restored?.payload as any).proof.pinCode).toBe('5678');

    if (!restored) throw new Error('Expected proof command to be restored');
    restored.state = 'ACKNOWLEDGED';
    await restarted.save(restored);
    expect(persisted).not.toContain('5678');
    expect((await restarted.get('cmd-sensitive-proof'))?.payload).not.toHaveProperty(
      'proof.pinCode',
    );
  });

  it('clears indexed proof secrets even when the mutation journal is corrupt', async () => {
    let persisted: string | null = null;
    const driver: DurableStorageDriver = {
      async getItem() { return persisted; },
      async setItem(_key, value) { persisted = value; },
      async removeItem() { persisted = null; },
      async clear() { persisted = null; },
    };
    const store = new CommandStore(driver);
    await store.save({
      commandId: 'cmd-corrupt-proof',
      id: 'cmd-corrupt-proof',
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-corrupt-proof',
      captainId: 'captain-sensitive',
      jobId: 'job-corrupt-proof',
      idempotencyKey: 'idemp-corrupt-proof',
      payload: { proof: { type: 'PIN', pinCode: '2468' } },
      payloadFingerprint: 'fp-corrupt-proof',
      createdAt: '2026-08-24T10:00:00Z',
      state: 'UNKNOWN',
      attemptCount: 1,
      updatedAt: '2026-08-24T10:00:01Z',
    });
    expect(await SecureStore.getItemAsync('mypetnew.captain.command_proof.v1.cmd-corrupt-proof'))
      .toBe('2468');

    persisted = '{{CORRUPT_JOURNAL}}';
    store.resetMemoryForTesting();
    await store.clear();

    expect(await SecureStore.getItemAsync('mypetnew.captain.command_proof.v1.cmd-corrupt-proof'))
      .toBeNull();
    expect(await SecureStore.getItemAsync('mypetnew.captain.command_proof_index.v1')).toBeNull();
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
