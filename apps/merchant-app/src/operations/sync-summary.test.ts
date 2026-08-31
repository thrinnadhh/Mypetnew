import { MerchantDatabase } from '../data/database/database';
import { createNodeSqliteDatabase } from '../data/database/node-driver';
import { createPartitionContext } from '../data/models/partition-context';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import { SyncStateRepository } from '../data/repositories/sync-state-repository';
import { summarizeOperationalSync } from './sync-summary';

describe('M11 SQLite sync and conflict visibility', () => {
  it('summarizes only authoritative outbox states and projection freshness', async () => {
    const driver = createNodeSqliteDatabase(':memory:');
    const database = new MerchantDatabase(driver);
    await database.initialize();
    const context = createPartitionContext('account-1', 'org-1', 'outlet-1');
    const outbox = new CommandOutboxRepository(database);
    const syncState = new SyncStateRepository(database);

    const enqueue = async (commandId: string, idempotencyKey: string) => outbox.enqueueCommand(context, {
      commandId,
      idempotencyKey,
      commandType: 'CATALOG_DEACTIVATE',
      payload: { outletId: context.outletId, listingId: `listing-${commandId}`, expectedVersion: 1, targetStatus: 'INACTIVE' },
    });

    await enqueue('pending', 'pending-key');
    await enqueue('retry', 'retry-key');
    await outbox.markRetryable(context, 'retry', '2026-09-01T00:00:00Z', 'NETWORK');
    await enqueue('reconcile', 'reconcile-key');
    await outbox.markNeedsReconciliation(context, 'reconcile', 'UNKNOWN_OUTCOME');
    await enqueue('rejected', 'rejected-key');
    await enqueue('blocked', 'blocked-key');
    await outbox.markRejected(context, 'rejected', 'VERSION_CONFLICT');
    await database.run(
      "UPDATE offline_commands SET state = 'BLOCKED' WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?",
      [context.accountId, context.organizationId, context.outletId, 'blocked'],
    );

    await syncState.recordSyncSuccess(context, 'CATALOG', 'cursor-1', '2026-08-31T09:59:00Z');
    await syncState.recordSyncFailure(context, 'INVENTORY', new Error('offline'), '2026-08-31T10:00:00Z');

    const summary = await summarizeOperationalSync(
      [context],
      syncState,
      outbox,
      { nowMs: Date.parse('2026-08-31T10:01:00Z') },
    );

    expect(summary.commands).toMatchObject({
      pending: 1,
      retry: 1,
      reconciliation: 1,
      rejected: 1,
      blocked: 1,
    });
    expect(summary.projections).toEqual([
      expect.objectContaining({ projection: 'BARCODE', freshness: 'never-synced' }),
      expect.objectContaining({ projection: 'CATALOG', freshness: 'fresh' }),
      expect.objectContaining({ projection: 'INVENTORY', freshness: 'sync-failed' }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('onHand');
    expect(JSON.stringify(summary)).not.toContain('sellingPrice');

    await database.close();
  });

  it('keeps summaries partition scoped', async () => {
    const driver = createNodeSqliteDatabase(':memory:');
    const database = new MerchantDatabase(driver);
    await database.initialize();
    const own = createPartitionContext('account-1', 'org-1', 'outlet-1');
    const foreign = createPartitionContext('account-2', 'org-2', 'outlet-2');
    const outbox = new CommandOutboxRepository(database);
    const syncState = new SyncStateRepository(database);
    await outbox.enqueueCommand(foreign, {
      commandId: 'foreign-command',
      idempotencyKey: 'foreign-key',
      commandType: 'CATALOG_DEACTIVATE',
      payload: { outletId: foreign.outletId, listingId: 'foreign', expectedVersion: 1, targetStatus: 'INACTIVE' },
    });

    const summary = await summarizeOperationalSync([own], syncState, outbox);
    expect(summary.commands.pending).toBe(0);
    await database.close();
  });
});
