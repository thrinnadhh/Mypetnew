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

  it('performs multi-page staged bootstrap and promotes live projections atomically on completion', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    let pageCount = 0;
    const mockFetch = async (url: string) => {
      pageCount += 1;
      if (url.includes('cursor=page_1_next')) {
        // Page 2 (Final)
        return new Response(
          JSON.stringify({
            catalogItems: [
              {
                id: 'item_page_2',
                organizationId: context.organizationId,
                outletId: context.outletId,
                barcodeType: 'INTERNAL',
                normalizedBarcode: 'BAR_P2',
                name: 'Product Page 2',
                kind: 'PRODUCT',
                commerceMode: 'PICKUP_AND_DELIVERY',
                mrpPaise: 2000,
                sellingPricePaise: 1800,
                category: 'food',
                status: 'ACTIVE',
                version: 1,
                imageUrls: [],
                createdAt: '2026-08-28T00:00:00.000Z',
                updatedAt: '2026-08-28T00:00:00.000Z',
              },
            ],
            inventoryBalances: [
              {
                listingId: 'item_page_2',
                onHand: 20,
                reserved: 5,
                version: 1,
                updatedAt: '2026-08-28T00:00:00.000Z',
              },
            ],
            nextCursor: null,
            hasMore: false,
            highWaterCursor: 'hw_cursor_final',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Page 1
      return new Response(
        JSON.stringify({
          catalogItems: [
            {
              id: 'item_page_1',
              organizationId: context.organizationId,
              outletId: context.outletId,
              barcodeType: 'INTERNAL',
              normalizedBarcode: 'BAR_P1',
              name: 'Product Page 1',
              kind: 'PRODUCT',
              commerceMode: 'PICKUP_AND_DELIVERY',
              mrpPaise: 1000,
              sellingPricePaise: 900,
              category: 'food',
              status: 'ACTIVE',
              version: 1,
              imageUrls: [],
              createdAt: '2026-08-28T00:00:00.000Z',
              updatedAt: '2026-08-28T00:00:00.000Z',
            },
          ],
          inventoryBalances: [
            {
              listingId: 'item_page_1',
              onHand: 10,
              reserved: 0,
              version: 1,
              updatedAt: '2026-08-28T00:00:00.000Z',
            },
          ],
          nextCursor: 'page_1_next',
          hasMore: true,
          highWaterCursor: 'hw_cursor_final',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await reconciler.rebootstrap(context);

    expect(pageCount).toBe(2);

    const item1 = await db.get<{ name: string }>(
      `SELECT name FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'item_page_1';`,
    );
    const item2 = await db.get<{ name: string }>(
      `SELECT name FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'item_page_2';`,
    );
    expect(item1?.name).toBe('Product Page 1');
    expect(item2?.name).toBe('Product Page 2');

    const bal1 = await db.get<{ on_hand: number; available: number }>(
      `SELECT on_hand, available FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = 'item_page_1';`,
    );
    const bal2 = await db.get<{ on_hand: number; available: number }>(
      `SELECT on_hand, available FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = 'item_page_2';`,
    );
    expect(bal1?.on_hand).toBe(10);
    expect(bal2?.available).toBe(15);

    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('FRESH');
    expect(state?.cursor).toBe('hw_cursor_final');

    await db.close();
  });

  it('safely handles interrupted multi-page bootstrap without corrupting live projections', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const syncRepo = new SyncStateRepository(db);

    // Initial state with existing item
    await db.run(
      `INSERT INTO ${TABLE_CATALOG_ITEMS} (
        account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
        barcode_type, normalized_barcode, mrp_paise, selling_price_paise, category,
        image_urls_json, status, version, is_tombstone, server_created_at, server_updated_at, local_updated_at
      ) VALUES (?, ?, ?, 'old_item', 'Old Item', 'PRODUCT', 'PICKUP_AND_DELIVERY', 'INTERNAL', 'BAR_OLD', 500, 400, 'food', '[]', 'ACTIVE', 1, 0, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z');`,
      [context.accountId, context.organizationId, context.outletId],
    );

    let pageCount = 0;
    const mockFetch = async (url: string) => {
      pageCount += 1;
      if (url.includes('cursor=page_1_next')) {
        // Crash / network error on page 2!
        throw new Error('NETWORK_TIMEOUT_ON_PAGE_2');
      }

      // Page 1 succeeds
      return new Response(
        JSON.stringify({
          catalogItems: [
            {
              id: 'staged_item_1',
              organizationId: context.organizationId,
              outletId: context.outletId,
              barcodeType: 'INTERNAL',
              normalizedBarcode: 'BAR_S1',
              name: 'Staged Item 1',
              kind: 'PRODUCT',
              commerceMode: 'PICKUP_AND_DELIVERY',
              mrpPaise: 1000,
              sellingPricePaise: 900,
              category: 'food',
              status: 'ACTIVE',
              version: 1,
              imageUrls: [],
              createdAt: '2026-08-28T00:00:00.000Z',
              updatedAt: '2026-08-28T00:00:00.000Z',
            },
          ],
          inventoryBalances: [],
          nextCursor: 'page_1_next',
          hasMore: true,
          highWaterCursor: 'hw_cursor_interrupted',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await expect(reconciler.rebootstrap(context)).rejects.toThrow('NETWORK_TIMEOUT_ON_PAGE_2');

    // Live projections must be completely preserved (old_item remains, staged_item_1 NOT promoted)
    const oldItem = await db.get<{ name: string }>(
      `SELECT name FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'old_item';`,
    );
    expect(oldItem?.name).toBe('Old Item');

    const stagedItem = await db.get(
      `SELECT * FROM ${TABLE_CATALOG_ITEMS} WHERE id = 'staged_item_1';`,
    );
    expect(stagedItem).toBeNull();

    // Sync state must reflect SYNC_FAILED
    const state = await syncRepo.getSyncState(context, 'all');
    expect(state?.status).toBe('SYNC_FAILED');

    await db.close();
  });
});
