import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { runMigrations } from '../../data/database/migrations';
import {
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_TOMBSTONES,
} from '../../data/database/schema';
import type { MerchantPartitionContext } from '../../data/models/partition-context';
import { SyncStateRepository } from '../../data/repositories/sync-state-repository';
import { SyncChangeFeedReconciler } from '../sync-change-feed-reconciler';

describe('SyncChangeFeedReconciler', () => {
  const context: MerchantPartitionContext = {
    accountId: 'acc_sync_1',
    organizationId: 'org_sync_1',
    outletId: 'out_sync_1',
  };

  it('reconciles catalog and inventory changes and updates sync state to FRESH', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          changes: [
            {
              sequenceNumber: 1,
              organizationId: context.organizationId,
              outletId: context.outletId,
              entityType: 'CATALOG_ITEM',
              entityId: 'item_1',
              entityVersion: 0,
              isTombstone: false,
              payload: JSON.stringify({
                id: 'item_1',
                organizationId: context.organizationId,
                outletId: context.outletId,
                barcodeType: 'INTERNAL',
                normalizedBarcode: 'BAR_1',
                name: 'Product 1',
                kind: 'PRODUCT',
                commerceMode: 'PICKUP_AND_DELIVERY',
                mrpPaise: 1000,
                sellingPricePaise: 800,
                category: 'food',
                status: 'ACTIVE',
                version: 0,
                createdAt: '2026-08-28T00:00:00.000Z',
                updatedAt: '2026-08-28T00:00:00.000Z',
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T00:00:00.000Z',
            },
            {
              sequenceNumber: 2,
              organizationId: context.organizationId,
              outletId: context.outletId,
              entityType: 'INVENTORY_BALANCE',
              entityId: 'item_1',
              entityVersion: 1,
              isTombstone: false,
              payload: JSON.stringify({
                organizationId: context.organizationId,
                outletId: context.outletId,
                listingId: 'item_1',
                onHand: 20,
                reserved: 0,
                version: 1,
                updatedAt: '2026-08-28T00:00:00.000Z',
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T00:00:00.000Z',
            },
          ],
          nextCursor: 'cursor_page_1',
          hasMore: false,
          currentHighWaterCursor: 'cursor_page_1',
          serverTime: '2026-08-28T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    const result = await reconciler.reconcile(context);

    expect(result.appliedChanges).toBe(2);
    expect(result.nextCursor).toBe('cursor_page_1');

    const item = await db.get<{ name: string; status: string }>(
      `SELECT name, status FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'item_1';`,
    );
    expect(item?.name).toBe('Product 1');
    expect(item?.status).toBe('ACTIVE');

    const balance = await db.get<{ on_hand: number }>(
      `SELECT on_hand FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = 'item_1';`,
    );
    expect(balance?.on_hand).toBe(20);

    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('FRESH');
    expect(state?.cursor).toBe('cursor_page_1');

    await db.close();
  });

  it('performs bounded multi-page rebootstrap and wipes obsolete tombstones', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    // Seed existing tombstone
    await db.run(
      `INSERT INTO ${TABLE_PROJECTION_TOMBSTONES} (
        account_id, organization_id, outlet_id, projection_name, entity_id,
        server_updated_at, server_version, deleted_at
      ) VALUES (?, ?, ?, 'catalog_items', 'old_deleted_item', '2026-08-27T00:00:00Z', 1, '2026-08-27T00:00:00Z');`,
      [context.accountId, context.organizationId, context.outletId],
    );

    let bootstrapPageCalls = 0;
    const mockFetch = async (url: string) => {
      if (url.includes('/api/v1/merchant/sync/bootstrap')) {
        bootstrapPageCalls += 1;
        if (bootstrapPageCalls === 1) {
          return new Response(
            JSON.stringify({
              highWaterCursor: 'high_water_boot',
              catalogItems: [
                {
                  id: 'boot_item_1',
                  organizationId: context.organizationId,
                  outletId: context.outletId,
                  barcodeType: 'INTERNAL',
                  normalizedBarcode: 'BOOT_1',
                  name: 'Boot Item 1',
                  kind: 'PRODUCT',
                  commerceMode: 'PICKUP_AND_DELIVERY',
                  mrpPaise: 500,
                  sellingPricePaise: 450,
                  category: 'food',
                  imageUrls: [],
                  status: 'ACTIVE',
                  version: 0,
                  createdAt: '2026-08-28T00:00:00.000Z',
                  updatedAt: '2026-08-28T00:00:00.000Z',
                },
              ],
              inventoryBalances: [],
              hasMore: true,
              nextCursor: 'boot_page_2_cursor',
              serverTime: '2026-08-28T00:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        } else {
          return new Response(
            JSON.stringify({
              highWaterCursor: 'high_water_boot',
              catalogItems: [],
              inventoryBalances: [
                {
                  organizationId: context.organizationId,
                  outletId: context.outletId,
                  listingId: 'boot_item_1',
                  onHand: 50,
                  reserved: 0,
                  version: 1,
                  updatedAt: '2026-08-28T00:00:00.000Z',
                },
              ],
              hasMore: false,
              nextCursor: null,
              serverTime: '2026-08-28T00:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
      return new Response('{}', { status: 404 });
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await reconciler.rebootstrap(context);

    expect(bootstrapPageCalls).toBe(2);

    // Old tombstone must be deleted
    const tombstone = await db.get(
      `SELECT * FROM ${TABLE_PROJECTION_TOMBSTONES} WHERE entity_id = 'old_deleted_item';`,
    );
    expect(tombstone).toBeNull();

    // Boot item and balance must exist
    const item = await db.get<{ name: string }>(
      `SELECT name FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'boot_item_1';`,
    );
    expect(item?.name).toBe('Boot Item 1');

    const bal = await db.get<{ on_hand: number }>(
      `SELECT on_hand FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = 'boot_item_1';`,
    );
    expect(bal?.on_hand).toBe(50);

    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('FRESH');
    expect(state?.cursor).toBe('high_water_boot');

    await db.close();
  });

  it('marks SYNC_FAILED and preserves previous cursor on HTTP 500', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    // Establish prior FRESH state with cursor C0
    await syncRepo.recordSyncSuccess(context, 'all', 'cursor_c0');

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Server database failure' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await expect(reconciler.reconcile(context)).rejects.toThrow('CHANGE_FEED_FETCH_FAILED');

    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('SYNC_FAILED');
    expect(state?.cursor).toBe('cursor_c0'); // Preserved!
    expect(state?.lastError).toContain('Server database failure');

    await db.close();
  });

  it('marks SYNC_FAILED and preserves previous cursor on network exception', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    await syncRepo.recordSyncSuccess(context, 'all', 'cursor_c0');

    const mockFetch = async () => {
      throw new Error('ECONNREFUSED: Connection failed');
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await expect(reconciler.reconcile(context)).rejects.toThrow('ECONNREFUSED');

    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('SYNC_FAILED');
    expect(state?.cursor).toBe('cursor_c0');
    expect(state?.lastError).toContain('ECONNREFUSED');

    await db.close();
  });

  it('rolls back entire page transaction when page contains valid event followed by unsupported schema version', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    await syncRepo.recordSyncSuccess(context, 'all', 'cursor_c0');

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          changes: [
            {
              sequenceNumber: 1,
              organizationId: context.organizationId,
              outletId: context.outletId,
              entityType: 'CATALOG_ITEM',
              entityId: 'valid_item_1',
              entityVersion: 0,
              isTombstone: false,
              payload: JSON.stringify({
                id: 'valid_item_1',
                organizationId: context.organizationId,
                outletId: context.outletId,
                barcodeType: 'INTERNAL',
                normalizedBarcode: 'V1_BAR',
                name: 'Valid Item',
                kind: 'PRODUCT',
                commerceMode: 'PICKUP_AND_DELIVERY',
                mrpPaise: 500,
                sellingPricePaise: 400,
                category: 'food',
                status: 'ACTIVE',
                version: 0,
                createdAt: '2026-08-28T00:00:00.000Z',
                updatedAt: '2026-08-28T00:00:00.000Z',
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T00:00:00.000Z',
            },
            {
              sequenceNumber: 2,
              organizationId: context.organizationId,
              outletId: context.outletId,
              entityType: 'CATALOG_ITEM',
              entityId: 'future_item_2',
              entityVersion: 0,
              isTombstone: false,
              payload: JSON.stringify({ id: 'future_item_2' }),
              schemaVersion: 99, // Unsupported future schema!
              createdAt: '2026-08-28T00:00:00.000Z',
            },
          ],
          nextCursor: 'cursor_c1',
          hasMore: false,
          currentHighWaterCursor: 'cursor_c1',
          serverTime: '2026-08-28T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await expect(reconciler.reconcile(context)).rejects.toThrow('UNSUPPORTED_EVENT_SCHEMA');

    // Event 1 must NOT be committed due to atomic rollback
    const item1 = await db.get(
      `SELECT * FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'valid_item_1';`,
    );
    expect(item1).toBeNull();

    // Cursor must remain cursor_c0 with SYNC_FAILED state
    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('SYNC_FAILED');
    expect(state?.cursor).toBe('cursor_c0');

    await db.close();
  });
});
