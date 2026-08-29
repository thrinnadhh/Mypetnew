import { DatabaseBootstrapper } from '../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../data/database/node-driver';
import { createPartitionContext } from '../data/models/partition-context';
import { SyncStateRepository } from '../data/repositories/sync-state-repository';
import { OfflineCatalogDraftRepository } from '../data/repositories/offline-catalog-draft-repository';
import { discoverOfflineCatalogPartitions } from './offline-partitions';

describe('M7 offline catalog partition discovery', () => {
  it('returns only partitions previously cached for the current account', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const mine = createPartitionContext('acc_current', 'org_a', 'out_a');
    const foreign = createPartitionContext('acc_foreign', 'org_b', 'out_b');
    const syncStates = new SyncStateRepository(db);
    await syncStates.upsertSyncState(mine, 'all', {
      status: 'FRESH',
      cursor: 'cursor-a',
      lastSyncAt: '2026-08-29T00:00:00Z',
      lastAttemptAt: '2026-08-29T00:00:00Z',
      lastError: null,
    });
    await syncStates.upsertSyncState(foreign, 'all', {
      status: 'FRESH',
      cursor: 'cursor-b',
      lastSyncAt: '2026-08-29T00:00:00Z',
      lastAttemptAt: '2026-08-29T00:00:00Z',
      lastError: null,
    });
    const drafts = new OfflineCatalogDraftRepository(db);
    await drafts.createDraft(createPartitionContext('acc_current', 'org_c', 'out_c'), {
      tempListingId: 'local_00000000-0000-4000-8000-000000000765',
      barcodeType: 'INTERNAL',
      barcode: 'LOCAL-PARTITION',
      name: 'Partition Draft',
      kind: 'PRODUCT',
      mrpPaise: 100,
      sellingPricePaise: 90,
      category: 'food',
    });

    const resolved = await discoverOfflineCatalogPartitions(db, 'acc_current');
    expect(resolved).toEqual([
      createPartitionContext('acc_current', 'org_a', 'out_a'),
      createPartitionContext('acc_current', 'org_c', 'out_c'),
    ]);
    expect(JSON.stringify(resolved)).not.toContain('acc_foreign');
    await db.close();
  });
});
