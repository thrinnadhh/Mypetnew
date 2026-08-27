import { createMerchantDatabase, MerchantDatabase } from '../../database/database';
import { createPartitionContext } from '../../models/partition-context';
import { SyncStateRepository } from '../sync-state-repository';

describe('M5 Sync State Repository and Freshness Model', () => {
  let db: MerchantDatabase;
  let repo: SyncStateRepository;
  const context = createPartitionContext('acc-1', 'org-1', 'outlet-1');
  const contextB = createPartitionContext('acc-2', 'org-2', 'outlet-2');

  beforeEach(async () => {
    db = createMerchantDatabase();
    await db.initialize();
    repo = new SyncStateRepository(db);
  });

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.close();
    }
  });

  it('returns never-synced for non-existent sync state', async () => {
    const state = await repo.getSyncState(context, 'CATALOG');
    expect(state).toBeNull();

    const freshness = await repo.getFreshness(context, 'CATALOG');
    expect(freshness).toBe('never-synced');
  });

  it('records successful sync and evaluates fresh status within TTL', async () => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const record = await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-100', nowIso);
    expect(record.status).toBe('FRESH');
    expect(record.cursor).toBe('cursor-100');
    expect(record.lastSyncAt).toBe(nowIso);

    const freshness = await repo.getFreshness(context, 'CATALOG', {
      nowMs: now + 60 * 1000, // 1 minute later
      maxAgeMs: 15 * 60 * 1000, // 15 min TTL
    });
    expect(freshness).toBe('fresh');
  });

  it('evaluates stale when time exceeds TTL', async () => {
    const syncTime = Date.now() - 20 * 60 * 1000; // 20 mins ago
    await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-old', new Date(syncTime).toISOString());

    const freshness = await repo.getFreshness(context, 'CATALOG', {
      nowMs: Date.now(),
      maxAgeMs: 15 * 60 * 1000, // 15 min TTL
    });
    expect(freshness).toBe('stale');
  });

  it('evaluates stale when marked stale explicitly', async () => {
    const nowIso = new Date().toISOString();
    await repo.recordSyncSuccess(context, 'INVENTORY', 'cursor-inv', nowIso);

    await repo.markStale(context, 'INVENTORY');

    const state = await repo.getSyncState(context, 'INVENTORY');
    expect(state?.status).toBe('STALE');

    const freshness = await repo.getFreshness(context, 'INVENTORY');
    expect(freshness).toBe('stale');
  });

  it('records sync failure and exposes sync-failed freshness', async () => {
    const failedAt = new Date().toISOString();
    const failureRecord = await repo.recordSyncFailure(
      context,
      'CATALOG',
      new Error('NETWORK_DISCONNECTED'),
      failedAt,
    );

    expect(failureRecord.status).toBe('SYNC_FAILED');
    expect(failureRecord.lastError).toBe('NETWORK_DISCONNECTED');
    expect(failureRecord.lastAttemptAt).toBe(failedAt);

    const freshness = await repo.getFreshness(context, 'CATALOG');
    expect(freshness).toBe('sync-failed');
  });

  it('enforces partition isolation across different accounts', async () => {
    await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-partition-a');

    const stateA = await repo.getSyncState(context, 'CATALOG');
    expect(stateA?.cursor).toBe('cursor-partition-a');

    const stateB = await repo.getSyncState(contextB, 'CATALOG');
    expect(stateB).toBeNull();
    expect(await repo.getFreshness(contextB, 'CATALOG')).toBe('never-synced');
  });
});
