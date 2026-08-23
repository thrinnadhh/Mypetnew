import { commandStore } from '../../sync/command-store';
import { MutationCommand } from '../../domain/command';

describe('Level 3: Durable CommandStore Persistence Tests', () => {
  beforeEach(async () => {
    await commandStore.clear();
  });

  it('persists and retrieves commands across memory resets', async () => {
    const cmd: MutationCommand = {
      commandId: 'cmd-level3-001',
      id: 'cmd-level3-001',
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-505',
      captainId: 'captain-101',
      jobId: 'job-505',
      idempotencyKey: 'idemp-cmd-505',
      payload: { jobId: 'job-505' },
      payloadFingerprint: 'fp-505',
      createdAt: '2026-08-23T10:00:00Z',
      state: 'PENDING',
      attemptCount: 0,
      lastAttemptAt: null,
      lastErrorCode: null,
      updatedAt: '2026-08-23T10:00:00Z',
    };

    await commandStore.save(cmd);

    // Simulate memory wipe / process restart
    commandStore.resetMemoryForTesting();

    const retrieved = await commandStore.get('cmd-level3-001');
    expect(retrieved).toBeDefined();
    expect(retrieved?.commandId).toBe('cmd-level3-001');
    expect(retrieved?.idempotencyKey).toBe('idemp-cmd-505');
    expect(retrieved?.resourceType).toBe('DELIVERY_JOB');
    expect(retrieved?.resourceId).toBe('job-505');
    expect(retrieved?.state).toBe('PENDING');
  });

  it('queries active commands by jobId and commandType', async () => {
    const cmd: MutationCommand = {
      commandId: 'cmd-level3-002',
      id: 'cmd-level3-002',
      commandType: 'MARK_DELIVERED',
      type: 'MARK_DELIVERED',
      resourceType: 'DELIVERY_JOB',
      resourceId: 'job-707',
      jobId: 'job-707',
      idempotencyKey: 'idemp-deliv-707',
      payload: { jobId: 'job-707' },
      payloadFingerprint: 'fp-707',
      createdAt: '2026-08-23T10:15:00Z',
      state: 'UNKNOWN',
      attemptCount: 1,
      updatedAt: '2026-08-23T10:15:00Z',
    };

    await commandStore.save(cmd);

    const found = await commandStore.getByJobAndType('job-707', 'MARK_DELIVERED');
    expect(found).toBeDefined();
    expect(found?.commandId).toBe('cmd-level3-002');
    expect(found?.state).toBe('UNKNOWN');
  });

  it('filters pending/sending/unknown commands from terminal acknowledged/rejected commands', async () => {
    const makeCmd = (id: string, state: any): MutationCommand => ({
      commandId: id,
      id,
      commandType: 'MARK_PICKED_UP',
      type: 'MARK_PICKED_UP',
      resourceType: 'DELIVERY_JOB',
      resourceId: `job-${id}`,
      idempotencyKey: `key-${id}`,
      payload: {},
      payloadFingerprint: `fp-${id}`,
      createdAt: new Date().toISOString(),
      state,
      attemptCount: 1,
      updatedAt: new Date().toISOString(),
    });

    await commandStore.save(makeCmd('c1', 'PENDING'));
    await commandStore.save(makeCmd('c2', 'ACKNOWLEDGED'));
    await commandStore.save(makeCmd('c3', 'UNKNOWN'));
    await commandStore.save(makeCmd('c4', 'REJECTED'));
    await commandStore.save(makeCmd('c5', 'SENDING'));

    const pending = await commandStore.listPending();
    const pendingIds = pending.map((c) => c.commandId).sort();
    expect(pendingIds).toEqual(['c1', 'c3', 'c5']);
  });
});
