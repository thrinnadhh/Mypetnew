import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { runMigrations } from '../../data/database/migrations';
import {
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
} from '../../data/database/schema';
import type { MerchantPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { SyncCoordinator } from '../sync-coordinator';
import { SyncTransport } from '../sync-transport';
import { SyncRetryPolicy } from '../retry-policy';
import { SyncChangeFeedReconciler } from '../sync-change-feed-reconciler';

describe('SyncCoordinator', () => {
  const context: MerchantPartitionContext = {
    accountId: 'acc_coord_1',
    organizationId: 'org_coord_1',
    outletId: 'out_coord_1',
  };

  it('resolves historical receipt for retried command without dispatching mutation again', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    const outboxRepo = new CommandOutboxRepository(db);

    const cmd = await outboxRepo.enqueueCommand(context, {
      commandType: 'INVENTORY_ADJUSTMENT',
      payloadSchemaVersion: 1,
      payload: {
        outletId: context.outletId,
        listingId: 'item_1',
        quantityDelta: 10,
        reason: 'MANUAL_INCREASE',
      },
      idempotencyKey: 'idemp_retry_1',
    });

    // Simulate that the command had a previous timeout / retry attempt
    await outboxRepo.markRetryable(
      context,
      cmd.commandId,
      '2026-08-28T00:00:00.000Z',
      'TIMEOUT',
      'Network timeout after server commit',
    );

    let dispatchCalled = false;
    let resolveCalled = false;

    const mockFetch = async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/merchant/sync/receipts/resolve')) {
        resolveCalled = true;
        return new Response(
          JSON.stringify({
            status: 'ACCEPTED',
            receiptId: 'mov_historical_100',
            resultingOnHand: 35,
            serverTimestamp: '2026-08-28T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/merchant/inventory/adjustments')) {
        dispatchCalled = true;
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/api/v1/merchant/sync/changes')) {
        return new Response(
          JSON.stringify({
            changes: [],
            nextCursor: 'c1',
            hasMore: false,
            currentHighWaterCursor: 'c1',
            serverTime: '2026-08-28T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const transport = new SyncTransport(mockFetch);
    const coordinator = new SyncCoordinator(db, transport, new SyncRetryPolicy());

    const summary = await coordinator.sync(context);

    expect(summary.commandsProcessed).toBe(1);
    expect(summary.acknowledged).toBe(1);
    expect(resolveCalled).toBe(true);
    expect(dispatchCalled).toBe(false); // Proves mutation was NOT called again!

    const stored = await outboxRepo.getCommand(context, cmd.commandId);
    expect(stored?.state).toBe('ACKNOWLEDGED');
    const receipt = stored?.durableServerReceipt ? JSON.parse(stored.durableServerReceipt) : null;
    expect(receipt?.receiptId).toBe('mov_historical_100');
    expect(receipt?.resultingOnHand).toBe(35);

    await db.close();
  });

  it('guarantees exactly one dispatch under two independent SQLite connection handles', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-multi-'));
    const tmpDbPath = path.join(tmpDir, 'test.db');

    const dbHandleA = createNodeSqliteDatabase(tmpDbPath);
    await runMigrations(dbHandleA);

    const dbHandleB = createNodeSqliteDatabase(tmpDbPath);

    const outboxRepoA = new CommandOutboxRepository(dbHandleA);

    const cmd = await outboxRepoA.enqueueCommand(context, {
      commandType: 'INVENTORY_ADJUSTMENT',
      payloadSchemaVersion: 1,
      payload: {
        outletId: context.outletId,
        listingId: 'item_multi_1',
        quantityDelta: 5,
        reason: 'MANUAL_INCREASE',
      },
      idempotencyKey: 'idemp_multi_1',
    });

    let dispatchCount = 0;
    const mockFetch = async (url: string) => {
      if (url.includes('/api/v1/merchant/inventory/adjustments')) {
        dispatchCount += 1;
        // Simulate small network delay
        await new Promise((r) => setTimeout(r, 20));
        return new Response(
          JSON.stringify({
            id: 'mov_multi_1',
            resultingOnHand: 5,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/merchant/sync/changes')) {
        return new Response(
          JSON.stringify({
            changes: [],
            nextCursor: 'c1',
            hasMore: false,
            currentHighWaterCursor: 'c1',
            serverTime: '2026-08-28T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const transportA = new SyncTransport(mockFetch);
    const transportB = new SyncTransport(mockFetch);

    const coordinatorA = new SyncCoordinator(dbHandleA, transportA, new SyncRetryPolicy(), undefined, 'worker-A');
    const coordinatorB = new SyncCoordinator(dbHandleB, transportB, new SyncRetryPolicy(), undefined, 'worker-B');

    // Run simultaneous sync across two independent SQLite handles
    const [summaryA, summaryB] = await Promise.all([
      coordinatorA.sync(context),
      coordinatorB.sync(context),
    ]);

    expect(dispatchCount).toBe(1);
    expect(summaryA.acknowledged + summaryB.acknowledged).toBe(1);

    const finalCmd = await outboxRepoA.getCommand(context, cmd.commandId);
    expect(finalCmd?.state).toBe('ACKNOWLEDGED');

    await dbHandleA.close();
    await dbHandleB.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converges to identical local state regardless of receipt vs feed ordering', async () => {
    // Sequence A: Receipt recovery ACKs command first -> Change feed applies same balance version later
    const dbA = createNodeSqliteDatabase(':memory:');
    await runMigrations(dbA);
    const outboxRepoA = new CommandOutboxRepository(dbA);
    const cmdA = await outboxRepoA.enqueueCommand(context, {
      commandType: 'INVENTORY_ADJUSTMENT',
      payloadSchemaVersion: 1,
      payload: {
        outletId: context.outletId,
        listingId: 'item_conv_1',
        quantityDelta: 10,
        reason: 'MANUAL_INCREASE',
      },
      idempotencyKey: 'idemp_conv_1',
    });

    // 1. Mark acknowledged from receipt
    await outboxRepoA.markAcknowledged(
      context,
      cmdA.commandId,
      {
        receiptId: 'mov_conv_1',
        resultingOnHand: 10,
        serverTimestamp: '2026-08-28T00:00:00Z',
      },
    );

    // 2. Change feed arrives with inventory balance version 1
    const reconcilerA = new SyncChangeFeedReconciler(dbA, async () => {
      return new Response(
        JSON.stringify({
          changes: [
            {
              sequenceNumber: 1,
              organizationId: context.organizationId,
              outletId: context.outletId,
              entityType: 'INVENTORY_BALANCE',
              entityId: 'item_conv_1',
              entityVersion: 1,
              isTombstone: false,
              payload: JSON.stringify({
                organizationId: context.organizationId,
                outletId: context.outletId,
                listingId: 'item_conv_1',
                onHand: 10,
                reserved: 0,
                version: 1,
                updatedAt: '2026-08-28T00:00:00Z',
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T00:00:00Z',
            },
          ],
          nextCursor: 'c_conv_1',
          hasMore: false,
          currentHighWaterCursor: 'c_conv_1',
          serverTime: '2026-08-28T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    await reconcilerA.reconcile(context);

    const balanceA = await dbA.get<{ on_hand: number }>(
      `SELECT on_hand FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = 'item_conv_1';`,
    );
    const cmdStateA = await outboxRepoA.getCommand(context, cmdA.commandId);

    // Sequence B: Change feed arrives first -> Receipt recovery ACKs command later
    const dbB = createNodeSqliteDatabase(':memory:');
    await runMigrations(dbB);
    const outboxRepoB = new CommandOutboxRepository(dbB);
    const cmdB = await outboxRepoB.enqueueCommand(context, {
      commandType: 'INVENTORY_ADJUSTMENT',
      payloadSchemaVersion: 1,
      payload: {
        outletId: context.outletId,
        listingId: 'item_conv_1',
        quantityDelta: 10,
        reason: 'MANUAL_INCREASE',
      },
      idempotencyKey: 'idemp_conv_1',
    });

    const reconcilerB = new SyncChangeFeedReconciler(dbB, async () => {
      return new Response(
        JSON.stringify({
          changes: [
            {
              sequenceNumber: 1,
              organizationId: context.organizationId,
              outletId: context.outletId,
              entityType: 'INVENTORY_BALANCE',
              entityId: 'item_conv_1',
              entityVersion: 1,
              isTombstone: false,
              payload: JSON.stringify({
                organizationId: context.organizationId,
                outletId: context.outletId,
                listingId: 'item_conv_1',
                onHand: 10,
                reserved: 0,
                version: 1,
                updatedAt: '2026-08-28T00:00:00Z',
              }),
              schemaVersion: 1,
              createdAt: '2026-08-28T00:00:00Z',
            },
          ],
          nextCursor: 'c_conv_1',
          hasMore: false,
          currentHighWaterCursor: 'c_conv_1',
          serverTime: '2026-08-28T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    await reconcilerB.reconcile(context);

    await outboxRepoB.markAcknowledged(
      context,
      cmdB.commandId,
      {
        receiptId: 'mov_conv_1',
        resultingOnHand: 10,
        serverTimestamp: '2026-08-28T00:00:00Z',
      },
    );

    const balanceB = await dbB.get<{ on_hand: number }>(
      `SELECT on_hand FROM ${TABLE_INVENTORY_BALANCES} WHERE listing_id = 'item_conv_1';`,
    );
    const cmdStateB = await outboxRepoB.getCommand(context, cmdB.commandId);

    // Both sequences converge identically
    expect(balanceA?.on_hand).toBe(10);
    expect(balanceB?.on_hand).toBe(10);
    expect(cmdStateA?.state).toBe('ACKNOWLEDGED');
    expect(cmdStateB?.state).toBe('ACKNOWLEDGED');

    await dbA.close();
    await dbB.close();
  });
});
