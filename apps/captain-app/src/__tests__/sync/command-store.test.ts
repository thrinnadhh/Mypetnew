import { commandStore, CommandStore } from '../../sync/command-store';
import { MutationCommand } from '../../domain/command';

describe('Durable CommandStore', () => {
  beforeEach(async () => {
    await commandStore.clear();
  });

  it('persists and retrieves a command by commandId', async () => {
    const cmd: MutationCommand = {
      commandId: 'cmd-test-1',
      id: 'cmd-test-1',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
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
    };

    await commandStore.save(cmd);

    const retrieved = await commandStore.get('cmd-test-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.commandId).toBe('cmd-test-1');
    expect(retrieved?.idempotencyKey).toBe('idemp-xyz-1');
    expect(retrieved?.captainId).toBe('captain-123');
    expect(retrieved?.jobId).toBe('job-999');
    expect(retrieved?.payloadFingerprint).toBe('fp-12345678');
  });

  it('queries active command by jobId and commandType', async () => {
    const cmd: MutationCommand = {
      commandId: 'cmd-test-pickup',
      id: 'cmd-test-pickup',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      jobId: 'job-888',
      idempotencyKey: 'idemp-pickup-888',
      payload: { jobId: 'job-888' },
      payloadFingerprint: 'fp-pickup-888',
      createdAt: new Date().toISOString(),
      state: 'UNKNOWN',
      attemptCount: 1,
    };

    await commandStore.save(cmd);

    const found = await commandStore.getByJobAndType('job-888', 'MARK_PICKED_UP');
    expect(found).toBeDefined();
    expect(found?.commandId).toBe('cmd-test-pickup');
    expect(found?.idempotencyKey).toBe('idemp-pickup-888');
    expect(found?.state).toBe('UNKNOWN');
  });

  it('lists only pending, sending, and unknown commands', async () => {
    const cmd1: MutationCommand = {
      commandId: 'cmd-1',
      id: 'cmd-1',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      idempotencyKey: 'k-1',
      payload: {},
      payloadFingerprint: 'fp-1',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
      attemptCount: 0,
    };
    const cmd2: MutationCommand = {
      commandId: 'cmd-2',
      id: 'cmd-2',
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      idempotencyKey: 'k-2',
      payload: {},
      payloadFingerprint: 'fp-2',
      createdAt: new Date().toISOString(),
      state: 'ACKNOWLEDGED',
      attemptCount: 1,
    };
    const cmd3: MutationCommand = {
      commandId: 'cmd-3',
      id: 'cmd-3',
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      idempotencyKey: 'k-3',
      payload: {},
      payloadFingerprint: 'fp-3',
      createdAt: new Date().toISOString(),
      state: 'UNKNOWN',
      attemptCount: 1,
    };
    const cmd4: MutationCommand = {
      commandId: 'cmd-4',
      id: 'cmd-4',
      commandType: 'ACCEPT_OFFER',
      type: 'ACCEPT_OFFER',
      idempotencyKey: 'k-4',
      payload: {},
      payloadFingerprint: 'fp-4',
      createdAt: new Date().toISOString(),
      state: 'REJECTED',
      attemptCount: 1,
    };

    await commandStore.save(cmd1);
    await commandStore.save(cmd2);
    await commandStore.save(cmd3);
    await commandStore.save(cmd4);

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(2);
    expect(pending.map((c) => c.commandId).sort()).toEqual(['cmd-1', 'cmd-3']);
  });
});
