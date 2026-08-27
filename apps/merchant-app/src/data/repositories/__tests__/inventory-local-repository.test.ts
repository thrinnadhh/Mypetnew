import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { InventoryLocalRepository } from '../inventory-local-repository';
import { SyncStateRepository } from '../sync-state-repository';
import { getTombstoneInTx } from '../tombstone-helper';

describe('M5 Inventory Local Repository (Monotonic Tombstones & Projections)', () => {
  const context = createPartitionContext('acc-1', 'org-1', 'out-1');

  it('A) live v3/t3 -> incoming tombstone v2/t2 => live v3 remains visible', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t2 = '2026-08-27T10:00:00.000Z';
    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Live row at v3 / t3
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-a',
      onHand: 100,
      reserved: 10,
      available: 90,
      version: 3,
      updatedAt: t3,
    });

    // 2. Incoming stale tombstone at v2 / t2
    const tombstoneResult = await inventoryRepo.markTombstone(context, 'inv-a', t2, 2);
    expect(tombstoneResult).toBe('STALE');

    // 3. Invariant: live row remains visible
    const balance = await inventoryRepo.getBalance(context, 'inv-a');
    expect(balance).not.toBeNull();
    expect(balance?.version).toBe(3);
    expect(balance?.available).toBe(90);

    await db.close();
  });

  it('B) live v3/t3 -> incoming tombstone with null version / t2 (t2 < t3) => live row remains visible', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t2 = '2026-08-27T10:00:00.000Z';
    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Live row at v3 / t3
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-b',
      onHand: 50,
      reserved: 5,
      available: 45,
      version: 3,
      updatedAt: t3,
    });

    // 2. Incoming tombstone with null version at t2
    const tombstoneResult = await inventoryRepo.markTombstone(context, 'inv-b', t2, null);
    expect(tombstoneResult).toBe('STALE');

    // 3. Invariant: live row remains visible
    const balance = await inventoryRepo.getBalance(context, 'inv-b');
    expect(balance).not.toBeNull();
    expect(balance?.version).toBe(3);

    await db.close();
  });

  it('C) existing tombstone v3/t3 -> incoming tombstone v2/t3 => tombstone authority remains v3', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Existing tombstone at v3 / t3
    const res1 = await inventoryRepo.markTombstone(context, 'inv-c', t3, 3);
    expect(res1).toBe('APPLIED');

    // 2. Incoming tombstone with lower version v2 at identical timestamp t3
    const res2 = await inventoryRepo.markTombstone(context, 'inv-c', t3, 2);
    expect(res2).toBe('STALE');

    // Invariant: authority remains v3 in ledger
    const tombstoneRecord = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'INVENTORY', 'inv-c');
    });
    expect(tombstoneRecord?.serverVersion).toBe(3);
    expect(tombstoneRecord?.serverUpdatedAt).toBe(t3);

    await db.close();
  });

  it('D) existing tombstone v3/t3 -> equal tombstone v3/t3 replay => idempotent with no downgrade', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Existing tombstone at v3 / t3
    const res1 = await inventoryRepo.markTombstone(context, 'inv-d', t3, 3);
    expect(res1).toBe('APPLIED');

    // 2. Replay equal tombstone
    const res2 = await inventoryRepo.markTombstone(context, 'inv-d', t3, 3);
    expect(res2).toBe('IDEMPOTENT');

    // Invariant: authority preserved
    const tombstoneRecord = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'INVENTORY', 'inv-d');
    });
    expect(tombstoneRecord?.serverVersion).toBe(3);
    expect(tombstoneRecord?.serverUpdatedAt).toBe(t3);

    await db.close();
  });

  it('E) live v1/t1 -> tombstone v2/t2 => delete applies and row is null', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Live row at v1 / t1
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-e',
      onHand: 100,
      reserved: 20,
      available: 80,
      version: 1,
      updatedAt: t1,
    });

    // 2. Tombstone at v2 / t2
    const res = await inventoryRepo.markTombstone(context, 'inv-e', t2, 2);
    expect(res).toBe('APPLIED');

    // 3. Invariant: row is null
    const balance = await inventoryRepo.getBalance(context, 'inv-e');
    expect(balance).toBeNull();

    await db.close();
  });

  it('F) unknown entity -> tombstone t2 => durable tombstone created in ledger', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t2 = '2026-08-27T11:00:00.000Z';

    const res = await inventoryRepo.markTombstone(context, 'unknown-inv-f', t2, 1);
    expect(res).toBe('APPLIED');

    const tombstoneRecord = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'INVENTORY', 'unknown-inv-f');
    });
    expect(tombstoneRecord).not.toBeNull();
    expect(tombstoneRecord?.serverUpdatedAt).toBe(t2);

    await db.close();
  });

  it('G) tombstone t2 -> stale live t1 => remains deleted and upsert returns null', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Tombstone at t2
    await inventoryRepo.markTombstone(context, 'inv-g', t2, 2);

    // 2. Stale balance at t1 arrives
    const upsertRes = await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-g',
      onHand: 100,
      reserved: 20,
      available: 80,
      version: 1,
      updatedAt: t1,
    });
    expect(upsertRes).toBeNull();

    // 3. Invariant: remains deleted
    const balance = await inventoryRepo.getBalance(context, 'inv-g');
    expect(balance).toBeNull();

    await db.close();
  });

  it('H) tombstone t2 -> genuinely newer live t3 => revival succeeds and tombstone cleared', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);

    const t2 = '2026-08-27T11:00:00.000Z';
    const t3 = '2026-08-27T12:00:00.000Z';

    // 1. Tombstone at t2, version 2
    await inventoryRepo.markTombstone(context, 'inv-h', t2, 2);

    // 2. Genuinely newer balance at t3, version 3
    const upsertRes = await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-h',
      onHand: 25,
      reserved: 5,
      available: 20,
      version: 3,
      updatedAt: t3,
    });
    expect(upsertRes).not.toBeNull();
    expect(upsertRes?.available).toBe(20);
    expect(upsertRes?.isTombstone).toBe(false);

    // 3. Invariant: visible in query
    const balance = await inventoryRepo.getBalance(context, 'inv-h');
    expect(balance).not.toBeNull();
    expect(balance?.available).toBe(20);

    // Ledger tombstone must be cleared
    const tombstone = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'INVENTORY', 'inv-h');
    });
    expect(tombstone).toBeNull();

    await db.close();
  });

  it('accurately counts only applied items and tombstones in applyProjectionBatch', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const inventoryRepo = new InventoryLocalRepository(db);
    const syncStateRepo = new SyncStateRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';
    const t3 = '2026-08-27T12:00:00.000Z';

    // Seed existing live row at v3/t3
    await inventoryRepo.upsertBalance(context, {
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: 'inv-existing-v3',
      onHand: 50,
      reserved: 10,
      available: 40,
      version: 3,
      updatedAt: t3,
    });

    // Seed existing tombstone at v3/t3
    await inventoryRepo.markTombstone(context, 'inv-tombstone-v3', t3, 3);

    // Batch contains:
    // 1. Fresh balance (should apply -> insertedCount + 1)
    // 2. Stale balance against tombstone (should reject -> insertedCount NOT incremented)
    // 3. Valid new tombstone (should apply -> tombstoneCount + 1)
    // 4. Stale tombstone against live v3 row (should reject -> tombstoneCount NOT incremented)
    const batchResult = await inventoryRepo.applyProjectionBatch(context, {
      balances: [
        {
          organizationId: context.organizationId,
          outletId: context.outletId,
          listingId: 'fresh-inv-1',
          onHand: 15,
          reserved: 3,
          available: 12,
          version: 1,
          updatedAt: t1,
        },
        {
          organizationId: context.organizationId,
          outletId: context.outletId,
          listingId: 'inv-tombstone-v3', // Stale against v3 tombstone
          onHand: 20,
          reserved: 0,
          available: 20,
          version: 1,
          updatedAt: t1,
        },
      ],
      tombstones: [
        { listingId: 'valid-inv-tombstone-1', updatedAt: t2 },
        { listingId: 'inv-existing-v3', updatedAt: t1 }, // Stale against live v3
      ],
      cursor: 'inv-cursor-v2',
    });

    expect(batchResult.insertedCount).toBe(1);
    expect(batchResult.tombstoneCount).toBe(1);

    const syncState = await syncStateRepo.getSyncState(context, 'INVENTORY');
    expect(syncState?.status).toBe('FRESH');
    expect(syncState?.cursor).toBe('inv-cursor-v2');

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
