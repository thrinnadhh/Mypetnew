import fs from 'fs';
import path from 'path';
import type { InventoryBalance } from '../../../inventory/api';
import { createMerchantDatabase, MerchantDatabase } from '../../database/database';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { InventoryLocalRepository } from '../inventory-local-repository';

describe('M5 Inventory Local Repository', () => {
  let db: MerchantDatabase;
  let repo: InventoryLocalRepository;
  const context = createPartitionContext('acc-1', 'org-1', 'outlet-1');

  beforeEach(async () => {
    db = createMerchantDatabase();
    await db.initialize();
    repo = new InventoryLocalRepository(db);
  });

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.close();
    }
  });

  const sampleBalance: InventoryBalance = {
    organizationId: 'org-1',
    outletId: 'outlet-1',
    listingId: 'listing-1',
    onHand: 50,
    reserved: 10,
    available: 40,
    version: 1,
    updatedAt: '2026-08-27T10:00:00.000Z',
  };

  it('inserts and retrieves inventory balance with canonical backend values', async () => {
    const inserted = await repo.upsertBalance(context, sampleBalance);

    expect(inserted.listingId).toBe('listing-1');
    expect(inserted.onHand).toBe(50);
    expect(inserted.reserved).toBe(10);
    expect(inserted.available).toBe(40);
    expect(inserted.version).toBe(1);

    const retrieved = await repo.getBalance(context, 'listing-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.onHand).toBe(50);
    expect(retrieved?.available).toBe(40);
  });

  it('updates balance projection on version increment', async () => {
    await repo.upsertBalance(context, sampleBalance);

    const updatedBalance: InventoryBalance = {
      ...sampleBalance,
      onHand: 60,
      available: 50,
      version: 2,
      updatedAt: '2026-08-27T11:00:00.000Z',
    };

    await repo.upsertBalance(context, updatedBalance);

    const retrieved = await repo.getBalance(context, 'listing-1');
    expect(retrieved?.onHand).toBe(60);
    expect(retrieved?.available).toBe(50);
    expect(retrieved?.version).toBe(2);
  });

  it('applies batch projection with multiple listings and tombstones', async () => {
    const batch = {
      balances: [
        sampleBalance,
        {
          ...sampleBalance,
          listingId: 'listing-2',
          onHand: 100,
          reserved: 0,
          available: 100,
        },
      ],
      tombstones: [{ listingId: 'listing-old', updatedAt: '2026-08-27T10:00:00.000Z' }],
      cursor: 'inv-cursor-1',
    };

    const result = await repo.applyProjectionBatch(context, batch);
    expect(result.insertedCount).toBe(2);
    expect(result.tombstoneCount).toBe(1);

    const list = await repo.listBalances(context);
    expect(list.items).toHaveLength(2);
    expect(list.totalCount).toBe(2);

    // Old tombstoned listing should not be in active list
    const oldBalance = await repo.getBalance(context, 'listing-old');
    expect(oldBalance).toBeNull();
  });

  it('filters inventory by listing IDs and supports pagination', async () => {
    await repo.applyProjectionBatch(context, {
      balances: [
        sampleBalance,
        { ...sampleBalance, listingId: 'listing-2' },
        { ...sampleBalance, listingId: 'listing-3' },
      ],
    });

    const filtered = await repo.listBalances(context, { listingIds: ['listing-1', 'listing-3'] });
    expect(filtered.items).toHaveLength(2);
    expect(filtered.items.map((i) => i.listingId)).toEqual(['listing-1', 'listing-3']);

    const paginated = await repo.listBalances(context, { page: 0, pageSize: 2 });
    expect(paginated.items).toHaveLength(2);
    expect(paginated.hasNext).toBe(true);
    expect(paginated.totalCount).toBe(3);
  });

  it('handles tombstones correctly', async () => {
    await repo.upsertBalance(context, sampleBalance);

    const tombstoned = await repo.markTombstone(context, 'listing-1');
    expect(tombstoned).toBe(true);

    const active = await repo.getBalance(context, 'listing-1');
    expect(active).toBeNull();

    const withTombstones = await repo.getBalance(context, 'listing-1', true);
    expect(withTombstones).not.toBeNull();
  });

  it('preserves inventory state across restart', async () => {
    const tempDbPath = path.join('/tmp', `merchant_inventory_restart_${Date.now()}.db`);

    try {
      const db1 = createMerchantDatabase({ db: createNodeSqliteDatabase(tempDbPath) });
      await db1.initialize();
      const repo1 = new InventoryLocalRepository(db1);

      await repo1.upsertBalance(context, sampleBalance);
      await db1.close();

      const db2 = createMerchantDatabase({ db: createNodeSqliteDatabase(tempDbPath) });
      await db2.initialize();
      const repo2 = new InventoryLocalRepository(db2);

      const persisted = await repo2.getBalance(context, 'listing-1');
      expect(persisted).not.toBeNull();
      expect(persisted?.available).toBe(40);
      expect(persisted?.onHand).toBe(50);

      await db2.close();
    } finally {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    }
  });
});
