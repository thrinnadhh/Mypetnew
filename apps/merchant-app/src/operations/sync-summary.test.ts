import { MerchantDatabase } from '../data/database/database';
import { createNodeSqliteDatabase } from '../data/database/node-driver';
import { createPartitionContext } from '../data/models/partition-context';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import { PartitionDiscoveryRepository } from '../data/repositories/partition-discovery-repository';
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
    await enqueue('sending', 'sending-key');
    await database.run(
      "UPDATE offline_commands SET state = 'SENDING' WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?",
      [context.accountId, context.organizationId, context.outletId, 'sending'],
    );
    await enqueue('acknowledged', 'acknowledged-key');
    await outbox.markAcknowledged(context, 'acknowledged', { serverTimestamp: '2026-08-31T10:00:00Z' });
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
      sending: 1,
      retry: 1,
      reconciliation: 1,
      rejected: 1,
      blocked: 1,
      acknowledged: 1,
    });
    expect(summary.projections).toEqual([
      expect.objectContaining({ projection: 'CATALOG', freshness: 'fresh' }),
      expect.objectContaining({ projection: 'INVENTORY', freshness: 'sync-failed' }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('onHand');
    expect(JSON.stringify(summary)).not.toContain('sellingPrice');

    await database.close();
  });

  it('uses the durable atomic change-feed state instead of inventing per-projection freshness', async () => {
    const driver = createNodeSqliteDatabase(':memory:');
    const database = new MerchantDatabase(driver);
    await database.initialize();
    const context = createPartitionContext('account-1', 'org-1', 'outlet-1');
    const outbox = new CommandOutboxRepository(database);
    const syncState = new SyncStateRepository(database);
    await syncState.recordSyncSuccess(context, 'CATALOG', 'legacy', '2026-08-31T08:00:00Z');
    await syncState.recordSyncSuccess(context, 'all', 'canonical', '2026-08-31T09:59:00Z');

    const summary = await summarizeOperationalSync(
      [context],
      syncState,
      outbox,
      { nowMs: Date.parse('2026-08-31T10:01:00Z') },
    );

    expect(summary.projections).toEqual([
      { outletId: context.outletId, projection: 'all', freshness: 'fresh' },
    ]);
    await database.close();
  });

  it('discovers an outbox-only partition for durable operational visibility', async () => {
    const driver = createNodeSqliteDatabase(':memory:');
    const database = new MerchantDatabase(driver);
    await database.initialize();
    const context = createPartitionContext('account-1', 'org-1', 'outlet-1');
    const outbox = new CommandOutboxRepository(database);
    await outbox.enqueueCommand(context, {
      commandId: 'outbox-only',
      idempotencyKey: 'outbox-only-key',
      commandType: 'CATALOG_DEACTIVATE',
      payload: { outletId: context.outletId, listingId: 'listing-1', expectedVersion: 1, targetStatus: 'INACTIVE' },
    });

    await expect(new PartitionDiscoveryRepository(database).listKnownPartitionsForAccount(context.accountId))
      .resolves.toEqual([context]);
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

describe('M11 manual retry identity safety', () => {
  it('reuses the durable command identity and refuses retry before retry-after', async () => {
    const driver = createNodeSqliteDatabase(':memory:');
    const database = new MerchantDatabase(driver);
    await database.initialize();
    const context = createPartitionContext('account-1', 'org-1', 'outlet-1');
    const outbox = new CommandOutboxRepository(database, () => Date.parse('2026-08-31T10:00:00Z'));
    const original = await outbox.enqueueCommand(context, {
      commandId: 'retry-same-command',
      idempotencyKey: 'retry-same-key',
      commandType: 'CATALOG_DEACTIVATE',
      payload: { outletId: context.outletId, listingId: 'listing-1', expectedVersion: 1, targetStatus: 'INACTIVE' },
    });
    await outbox.markRetryable(context, original.commandId, '2026-08-31T10:05:00Z', 'RATE_LIMITED');
    await expect(outbox.requestManualRetry(context, original.commandId, Date.parse('2026-08-31T10:04:59Z')))
      .rejects.toThrow('COMMAND_RETRY_AFTER_PENDING');
    const retried = await outbox.requestManualRetry(context, original.commandId, Date.parse('2026-08-31T10:05:00Z'));
    expect(retried).toMatchObject({ commandId: original.commandId, idempotencyKey: original.idempotencyKey, state: 'PENDING' });
    expect((await outbox.listCommands(context)).filter((item) => item.commandId === original.commandId)).toHaveLength(1);
    await database.close();
  });

  it('refuses rejected and reconciliation commands instead of replaying unknown outcomes', async () => {
    const driver = createNodeSqliteDatabase(':memory:');
    const database = new MerchantDatabase(driver);
    await database.initialize();
    const context = createPartitionContext('account-1', 'org-1', 'outlet-1');
    const outbox = new CommandOutboxRepository(database);
    const make = async (id: string) => outbox.enqueueCommand(context, {
      commandId: id, idempotencyKey: `idem-${id}`, commandType: 'CATALOG_DEACTIVATE',
      payload: { outletId: context.outletId, listingId: id, expectedVersion: 1, targetStatus: 'INACTIVE' },
    });
    await make('rejected'); await outbox.markRejected(context, 'rejected', 'VERSION_CONFLICT');
    await make('reconcile'); await outbox.markNeedsReconciliation(context, 'reconcile', 'UNKNOWN_OUTCOME');
    await expect(outbox.requestManualRetry(context, 'rejected')).rejects.toThrow('COMMAND_RETRY_NOT_ALLOWED');
    await expect(outbox.requestManualRetry(context, 'reconcile')).rejects.toThrow('COMMAND_RETRY_NOT_ALLOWED');
    await database.close();
  });
});
