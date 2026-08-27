import { DatabaseBootstrapper } from '../bootstrap';
import { createNodeSqliteDatabase } from '../node-driver';
import {
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_SYNC_STATE,
  TABLE_PROJECTION_TOMBSTONES,
} from '../schema';

describe('M5 SQLite Partition Isolation (Account, Org, Outlet)', () => {
  it('enforces complete partition isolation across account, org, and outlet for all tables', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const partition1 = { accountId: 'acc-1', organizationId: 'org-1', outletId: 'out-1' };
    const partition2 = { accountId: 'acc-2', organizationId: 'org-2', outletId: 'out-2' };

    // 1. Insert in partition 1
    await db.run(
      `INSERT INTO ${TABLE_CATALOG_ITEMS} (
        account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
        barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
        category, status, version, server_created_at, server_updated_at, local_updated_at
      ) VALUES (?, ?, ?, 'prod-1', 'Partition 1 Food', 'FOOD', 'PICKUP', 'INTERNAL', 'P1-001', 1000, 900, 'Food', 'ACTIVE', 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');`,
      [partition1.accountId, partition1.organizationId, partition1.outletId],
    );

    await db.run(
      `INSERT INTO ${TABLE_CATALOG_BARCODES} (
        account_id, organization_id, outlet_id, listing_id, barcode_type, normalized_barcode, is_primary, is_tombstone, updated_at
      ) VALUES (?, ?, ?, 'prod-1', 'INTERNAL', 'P1-001', 1, 0, '2026-08-27T00:00:00Z');`,
      [partition1.accountId, partition1.organizationId, partition1.outletId],
    );

    await db.run(
      `INSERT INTO ${TABLE_INVENTORY_BALANCES} (
        account_id, organization_id, outlet_id, listing_id, on_hand, reserved, available, version, server_updated_at, local_updated_at
      ) VALUES (?, ?, ?, 'prod-1', 50, 10, 40, 1, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');`,
      [partition1.accountId, partition1.organizationId, partition1.outletId],
    );

    await db.run(
      `INSERT INTO ${TABLE_PROJECTION_SYNC_STATE} (
        account_id, organization_id, outlet_id, projection_name, last_sync_at, status
      ) VALUES (?, ?, ?, 'CATALOG', '2026-08-27T00:00:00Z', 'FRESH');`,
      [partition1.accountId, partition1.organizationId, partition1.outletId],
    );

    await db.run(
      `INSERT INTO ${TABLE_PROJECTION_TOMBSTONES} (
        account_id, organization_id, outlet_id, projection_name, entity_id, server_updated_at, deleted_at
      ) VALUES (?, ?, ?, 'CATALOG', 'deleted-prod-1', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');`,
      [partition1.accountId, partition1.organizationId, partition1.outletId],
    );

    // 2. Query with partition 2 credentials -> must return 0 results
    const catalogP2 = await db.all(
      `SELECT * FROM ${TABLE_CATALOG_ITEMS} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
      [partition2.accountId, partition2.organizationId, partition2.outletId],
    );
    expect(catalogP2).toHaveLength(0);

    const barcodesP2 = await db.all(
      `SELECT * FROM ${TABLE_CATALOG_BARCODES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
      [partition2.accountId, partition2.organizationId, partition2.outletId],
    );
    expect(barcodesP2).toHaveLength(0);

    const inventoryP2 = await db.all(
      `SELECT * FROM ${TABLE_INVENTORY_BALANCES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
      [partition2.accountId, partition2.organizationId, partition2.outletId],
    );
    expect(inventoryP2).toHaveLength(0);

    const syncP2 = await db.all(
      `SELECT * FROM ${TABLE_PROJECTION_SYNC_STATE} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
      [partition2.accountId, partition2.organizationId, partition2.outletId],
    );
    expect(syncP2).toHaveLength(0);

    const tombstonesP2 = await db.all(
      `SELECT * FROM ${TABLE_PROJECTION_TOMBSTONES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
      [partition2.accountId, partition2.organizationId, partition2.outletId],
    );
    expect(tombstonesP2).toHaveLength(0);

    // 3. Query with partition 1 credentials -> must return exact data
    const catalogP1 = await db.all(
      `SELECT * FROM ${TABLE_CATALOG_ITEMS} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
      [partition1.accountId, partition1.organizationId, partition1.outletId],
    );
    expect(catalogP1).toHaveLength(1);

    await db.close();
  });
});
