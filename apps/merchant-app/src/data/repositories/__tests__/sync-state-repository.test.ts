import { createMerchantDatabase, MerchantDatabase } from '../../database/database';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { SyncStateRepository } from '../sync-state-repository';

describe('M5 Sync State Repository and Freshness Model', () => {
  let db: MerchantDatabase;
  let repo: SyncStateRepository;
  const context = createPartitionContext('acc-1', 'org-1', 'outlet-1');
  const contextB = createPartitionContext('acc-2', 'org-2', 'outlet-2');

  beforeEach(async () => {
    db = createMerchantDatabase({ db: createNodeSqliteDatabase(':memory:') });
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
    const now = '2026-08-27T12:00:00.000Z';
    const nowMs = Date.parse(now);

    await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-123', now);

    const state = await repo.getSyncState(context, 'CATALOG');
    expect(state).not.toBeNull();
    expect(state?.status).toBe('FRESH');
    expect(state?.cursor).toBe('cursor-123');
    expect(state?.lastSyncAt).toBe(now);

    const freshness = await repo.getFreshness(context, 'CATALOG', {
      nowMs: nowMs + 5 * 60 * 1000, // +5 mins
    });
    expect(freshness).toBe('fresh');
  });

  it('evaluates status as stale when elapsed time exceeds TTL', async () => {
    const syncTime = '2026-08-27T12:00:00.000Z';
    const syncTimeMs = Date.parse(syncTime);

    await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-123', syncTime);

    const freshness = await repo.getFreshness(context, 'CATALOG', {
      nowMs: syncTimeMs + 20 * 60 * 1000, // +20 mins (TTL = 15m)
    });
    expect(freshness).toBe('stale');
  });

  it('evaluates status as stale when explicitly marked stale', async () => {
    const now = '2026-08-27T12:00:00.000Z';
    await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-123', now);
    await repo.markStale(context, 'CATALOG');

    const freshness = await repo.getFreshness(context, 'CATALOG');
    expect(freshness).toBe('stale');
  });

  it('evaluates status as sync-failed on error record', async () => {
    await repo.recordSyncFailure(context, 'CATALOG', 'NETWORK_TIMEOUT');

    const state = await repo.getSyncState(context, 'CATALOG');
    expect(state?.status).toBe('SYNC_FAILED');
    expect(state?.lastError).toBe('NETWORK_TIMEOUT');

    const freshness = await repo.getFreshness(context, 'CATALOG');
    expect(freshness).toBe('sync-failed');
  });

  it('preserves isolation between different partition contexts', async () => {
    const now = '2026-08-27T12:00:00.000Z';
    await repo.recordSyncSuccess(context, 'CATALOG', 'cursor-A', now);

    const stateA = await repo.getSyncState(context, 'CATALOG');
    const stateB = await repo.getSyncState(contextB, 'CATALOG');

    expect(stateA).not.toBeNull();
    expect(stateA?.cursor).toBe('cursor-A');
    expect(stateB).toBeNull();
  });
});
