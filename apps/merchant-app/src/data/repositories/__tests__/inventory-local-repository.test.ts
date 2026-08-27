import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { InventoryLocalRepository } from '../inventory-local-repository';
import { SyncStateRepository } from '../sync-state-repository';

describe('M5 Inventory Local Repository (Monotonic Tombstones & Projections)', () => {
  const context = createPartitionContext('acc-1', 'org-1', 'out-1');

  it('C) tombstone inventory at t2 -> apply stale inventory balance at t1 => remains NOT visible', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Insert inventory balance @ t1
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-item-1',
      onHand: 100,
      reserved: 20,
      available: 80,
      version: 1,
      updatedAt: t1,
    });

    const initial = await inventoryRepo.getBalance(context, 'inv-item-1');
    expect(initial).not.toBeNull();
    expect(initial?.available).toBe(80);

    // 2. Tombstone @ t2 (t2 > t1)
    await inventoryRepo.markTombstone(context, 'inv-item-1', t2, 1);

    const deleted = await inventoryRepo.getBalance(context, 'inv-item-1');
    expect(deleted).toBeNull();

    // 3. Stale inventory balance @ t1 arrives later
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-item-1',
      onHand: 100,
      reserved: 20,
      available: 80,
      version: 1,
      updatedAt: t1,
    });

    // 4. Invariant: MUST REMAIN DELETED / NOT VISIBLE
    const balanceAfterStale = await inventoryRepo.getBalance(context, 'inv-item-1');
    expect(balanceAfterStale).toBeNull();

    const listResult = await inventoryRepo.listBalances(context);
    expect(listResult.items).toHaveLength(0);

    await db.close();
  });

  it('D) tombstone unknown inventory ID at t2 -> apply stale balance at t1 => remains NOT visible', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Tombstone arrives for unknown inventory item
    await inventoryRepo.markTombstone(context, 'unknown-inv-99', t2, 1);

    // 2. Stale balance @ t1 arrives
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'unknown-inv-99',
      onHand: 50,
      reserved: 5,
      available: 45,
      version: 1,
      updatedAt: t1,
    });

    // 3. Invariant: MUST REMAIN DELETED
    const balance = await inventoryRepo.getBalance(context, 'unknown-inv-99');
    expect(balance).toBeNull();

    await db.close();
  });

  it('E) newer authoritative inventory balance (v3 / t3 > t2) after older tombstone (v2 / t2) => accepted', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';
    const t3 = '2026-08-27T12:00:00.000Z';

    // Balance @ t1
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'recreated-inv-1',
      onHand: 10,
      reserved: 0,
      available: 10,
      version: 1,
      updatedAt: t1,
    });

    // Tombstone @ t2, version 2
    await inventoryRepo.markTombstone(context, 'recreated-inv-1', t2, 2);

    // Genuinely newer server balance @ t3, version 3
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'recreated-inv-1',
      onHand: 25,
      reserved: 5,
      available: 20,
      version: 3,
      updatedAt: t3,
    });

    // Invariant: Accepted and visible
    const balance = await inventoryRepo.getBalance(context, 'recreated-inv-1');
    expect(balance).not.toBeNull();
    expect(balance?.onHand).toBe(25);
    expect(balance?.available).toBe(20);
    expect(balance?.version).toBe(3);

    await db.close();
  });

  it('F) applies inventory batch projection atomically including tombstones and cursor updates', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);
    const syncStateRepo = new SyncStateRepository(db);

    const now = new Date().toISOString();

    const batchResult = await inventoryRepo.applyProjectionBatch(context, {
      balances: [
        {
          organizationId: context.organizationId,
          outletId: context.outletId,
          listingId: 'inv-batch-1',
          onHand: 15,
          reserved: 3,
          available: 12,
          version: 1,
          updatedAt: now,
        },
      ],
      tombstones: [{ listingId: 'inv-tombstone-1', updatedAt: now }],
      cursor: 'inv-cursor-v1',
    });

    expect(batchResult.insertedCount).toBe(1);
    expect(batchResult.tombstoneCount).toBe(1);

    const syncState = await syncStateRepo.getSyncState(context, 'INVENTORY');
    expect(syncState?.status).toBe('FRESH');
    expect(syncState?.cursor).toBe('inv-cursor-v1');

    const balance = await inventoryRepo.getBalance(context, 'inv-batch-1');
    expect(balance).not.toBeNull();
    expect(balance?.available).toBe(12);

    await db.close();
  });

  it('filters by listingIds and supports pagination', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);
    const now = new Date().toISOString();

    for (let i = 1; i <= 5; i++) {
      await inventoryRepo.upsertBalance(context, {
        organizationId: context.organizationId,
        outletId: context.outletId,
        listingId: `item-${i}`,
        onHand: 10 * i,
        reserved: i,
        available: 9 * i,
        version: 1,
        updatedAt: now,
      });
    }

    const filtered = await inventoryRepo.listBalances(context, {
      listingIds: ['item-2', 'item-4'],
    });
    expect(filtered.items).toHaveLength(2);

    const paged = await inventoryRepo.listBalances(context, { page: 0, pageSize: 3 });
    expect(paged.items).toHaveLength(3);
    expect(paged.hasNext).toBe(true);

    await db.close();
  });
});
