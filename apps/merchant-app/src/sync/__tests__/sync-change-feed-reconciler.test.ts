import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import {
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_OFFLINE_COMMANDS,
  TABLE_PROJECTION_TOMBSTONES,
} from '../../data/database/schema';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { SyncStateRepository } from '../../data/repositories/sync-state-repository';
import { SyncChangeFeedReconciler } from '../sync-change-feed-reconciler';

describe('M6 SyncChangeFeedReconciler', () => {
  const context = createPartitionContext('acc_1', 'org_1', 'out_1');

  it('applies change feed pages atomically to local projections and advances cursor', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          changes: [
            {
              sequenceNumber: 1,
              organizationId: 'org_1',
              outletId: 'out_1',
              entityType: 'CATALOG_ITEM',
              entityId: 'item_1',
              entityVersion: 1,
              isTombstone: false,
              payload: JSON.stringify({
                name: 'Dog Food',
                kind: 'PRODUCT',
                commerceMode: 'COMMERCE',
                barcodeType: 'GTIN_13',
                normalizedBarcode: '8901234567890',
                mrpPaise: 1000,
                sellingPricePaise: 900,
                category: 'food',
                status: 'ACTIVE',
                imageUrls: ['https://example.com/img1.jpg'],
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T12:00:00.000Z',
            },
            {
              sequenceNumber: 2,
              organizationId: 'org_1',
              outletId: 'out_1',
              entityType: 'INVENTORY_BALANCE',
              entityId: 'item_1',
              entityVersion: 1,
              isTombstone: false,
              payload: JSON.stringify({
                onHand: 25,
                reserved: 5,
                available: 20,
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T12:00:01.000Z',
            },
          ],
          nextCursor: 'cursor_page_1',
          hasMore: false,
          currentHighWaterCursor: 'cursor_page_1',
          serverTime: '2026-08-28T12:00:01.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    const result = await reconciler.reconcile(context);

    expect(result.appliedChanges).toBe(2);
    expect(result.nextCursor).toBe('cursor_page_1');

    // Verify catalog projection
    const item = await db.get<{ name: string; version: number }>(
      `SELECT name, version FROM ${TABLE_CATALOG_ITEMS} WHERE id = ?;`,
      ['item_1'],
    );
    expect(item?.name).toBe('Dog Food');
    expect(item?.version).toBe(1);

    // Verify inventory projection
    const balance = await db.get<{ on_hand: number; reserved: number; available: number }>(
      `SELECT on_hand, reserved, available FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = ?;`,
      ['item_1'],
    );
    expect(balance?.on_hand).toBe(25);
    expect(balance?.reserved).toBe(5);
    expect(balance?.available).toBe(20);

    // Verify cursor updated in projection_sync_state
    const syncState = await new SyncStateRepository(db).getSyncState(context, 'all');
    expect(syncState?.cursor).toBe('cursor_page_1');
    expect(syncState?.status).toBe('FRESH');

    await db.close();
  });

  it('handles tombstones by updating projection items and persisting in projection_tombstones', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          changes: [
            {
              sequenceNumber: 3,
              organizationId: 'org_1',
              outletId: 'out_1',
              entityType: 'CATALOG_ITEM',
              entityId: 'item_deleted',
              entityVersion: 5,
              isTombstone: true,
              payload: JSON.stringify({ status: 'INACTIVE' }),
              schemaVersion: 1,
              createdAt: '2026-08-28T12:00:02.000Z',
            },
          ],
          nextCursor: 'cursor_tombstone',
          hasMore: false,
          currentHighWaterCursor: 'cursor_tombstone',
          serverTime: '2026-08-28T12:00:02.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await reconciler.reconcile(context);

    const tombstone = await db.get<{ entity_id: string; server_version: number }>(
      `SELECT entity_id, server_version FROM ${TABLE_PROJECTION_TOMBSTONES} WHERE entity_id = ?;`,
      ['item_deleted'],
    );
    expect(tombstone?.entity_id).toBe('item_deleted');
    expect(tombstone?.server_version).toBe(5);

    await db.close();
  });

  it('rebootstraps projection on SYNC_CURSOR_EXPIRED while strictly preserving offline outbox commands', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    // Queue an offline command first
    const outboxRepo = new CommandOutboxRepository(db);
    await outboxRepo.enqueueCommand(context, {
      commandId: 'cmd_must_survive',
      installationId: 'inst_1',
      idempotencyKey: 'idem_survive',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 3, reason: 'MANUAL_INCREASE' },
    });

    const mockFetch = async (url: string) => {
      if (url.includes('/changes')) {
        return new Response(
          JSON.stringify({ code: 'SYNC_CURSOR_EXPIRED', message: 'Cursor expired' }),
          { status: 410, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/bootstrap')) {
        return new Response(
          JSON.stringify({
            highWaterCursor: 'new_bootstrap_cursor_999',
            catalogItems: [
              {
                id: 'bootstrapped_item',
                organizationId: 'org_1',
                outletId: 'out_1',
                barcodeType: 'GTIN_13',
                normalizedBarcode: '8909999999999',
                name: 'Bootstrapped Product',
                kind: 'PRODUCT',
                commerceMode: 'COMMERCE',
                mrpPaise: 500,
                sellingPricePaise: 400,
                category: 'food',
                status: 'ACTIVE',
                imageUrls: [],
                version: 1,
                createdAt: '2026-08-28T12:00:00.000Z',
                updatedAt: '2026-08-28T12:00:00.000Z',
              },
            ],
            inventoryBalances: [
              {
                organizationId: 'org_1',
                outletId: 'out_1',
                listingId: 'bootstrapped_item',
                onHand: 100,
                reserved: 10,
                version: 1,
                updatedAt: '2026-08-28T12:00:00.000Z',
              },
            ],
            serverTime: '2026-08-28T12:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const reconciler = new SyncChangeFeedReconciler(db, mockFetch);
    await reconciler.reconcile(context);

    // Verify outbox command survived rebootstrap!
    const outboxCommand = await outboxRepo.getCommand(context, 'cmd_must_survive');
    expect(outboxCommand).not.toBeNull();
    expect(outboxCommand?.commandId).toBe('cmd_must_survive');
    expect(outboxCommand?.state).toBe('PENDING');

    // Verify bootstrapped items
    const item = await db.get<{ name: string }>(
      `SELECT name FROM ${TABLE_CATALOG_ITEMS} WHERE id = ?;`,
      ['bootstrapped_item'],
    );
    expect(item?.name).toBe('Bootstrapped Product');

    // Verify new high-water cursor set
    const syncState = await new SyncStateRepository(db).getSyncState(context, 'all');
    expect(syncState?.cursor).toBe('new_bootstrap_cursor_999');

    await db.close();
  });
});
