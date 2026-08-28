import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { SyncRetryPolicy } from '../retry-policy';
import { SyncTransport } from '../sync-transport';
import { SyncCoordinator } from '../sync-coordinator';

describe('M6 SyncCoordinator', () => {
  const contextA = createPartitionContext('acc_1', 'org_1', 'out_1');
  const contextB = createPartitionContext('acc_2', 'org_2', 'out_2');

  it('demonstrates partial success: A succeeds, B fails validation (400), C depends on B -> A=ACKNOWLEDGED, B=REJECTED, C=BLOCKED', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const outboxRepo = new CommandOutboxRepository(db);

    // Queue A
    await outboxRepo.enqueueCommand(contextA, {
      commandId: 'cmd_A',
      installationId: 'inst_1',
      idempotencyKey: 'idem_A',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 5, reason: 'MANUAL_INCREASE' },
    });

    // Queue B
    await outboxRepo.enqueueCommand(contextA, {
      commandId: 'cmd_B',
      installationId: 'inst_1',
      idempotencyKey: 'idem_B',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_bad', expectedVersion: 1, name: '', mrpPaise: 0, sellingPricePaise: 0, category: '' },
    });

    // Queue C depending on B
    await outboxRepo.enqueueCommand(contextA, {
      commandId: 'cmd_C',
      installationId: 'inst_1',
      idempotencyKey: 'idem_C',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_bad', quantityDelta: 2, reason: 'MANUAL_INCREASE' },
      dependsOnCommandIds: ['cmd_B'],
    });

    const mockFetch = async (path: string, init?: RequestInit) => {
      if (path.includes('/inventory/adjustments')) {
        return new Response(
          JSON.stringify({ id: 'receipt_A', resultingOnHand: 10, resultingReserved: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (path.includes('/listings/list_bad')) {
        return new Response(
          JSON.stringify({ code: 'CATALOG_VALIDATION_ERROR', message: 'Name and price cannot be empty' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const transport = new SyncTransport(mockFetch);
    const retryPolicy = new SyncRetryPolicy();
    const coordinator = new SyncCoordinator(db, transport, retryPolicy);

    const summary = await coordinator.sync(contextA);

    expect(summary.commandsProcessed).toBe(2); // A and B processed, C was blocked!
    expect(summary.acknowledged).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.blocked).toBe(1);

    const cmdA = await outboxRepo.getCommand(contextA, 'cmd_A');
    expect(cmdA?.state).toBe('ACKNOWLEDGED');
    expect(cmdA?.durableServerReceipt).toContain('receipt_A');

    const cmdB = await outboxRepo.getCommand(contextA, 'cmd_B');
    expect(cmdB?.state).toBe('REJECTED');
    expect(cmdB?.lastErrorCode).toBe('CATALOG_VALIDATION_ERROR');

    const cmdC = await outboxRepo.getCommand(contextA, 'cmd_C');
    expect(cmdC?.state).toBe('BLOCKED');
    expect(cmdC?.lastErrorCode).toBe('PARENT_COMMAND_REJECTED');

    await db.close();
  });

  it('quarantines Account A commands when syncing under Account B context', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const outboxRepo = new CommandOutboxRepository(db);

    await outboxRepo.enqueueCommand(contextA, {
      commandId: 'cmd_user_A',
      installationId: 'inst_1',
      idempotencyKey: 'idem_A',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 5, reason: 'MANUAL_INCREASE' },
    });

    let networkCalled = false;
    const mockFetch = async () => {
      networkCalled = true;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const transport = new SyncTransport(mockFetch);
    const coordinator = new SyncCoordinator(db, transport);

    // Sync under contextB
    const summaryB = await coordinator.sync(contextB);
    expect(summaryB.commandsProcessed).toBe(0);
    expect(networkCalled).toBe(false);

    // Command under contextA is still PENDING
    const cmdA = await outboxRepo.getCommand(contextA, 'cmd_user_A');
    expect(cmdA?.state).toBe('PENDING');

    await db.close();
  });

  it('enforces single-flight execution per partition avoiding race conditions between overlapping sync triggers', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const outboxRepo = new CommandOutboxRepository(db);

    await outboxRepo.enqueueCommand(contextA, {
      commandId: 'cmd_concurrent',
      installationId: 'inst_1',
      idempotencyKey: 'idem_conc',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 5, reason: 'MANUAL_INCREASE' },
    });

    let dispatchCount = 0;
    const mockFetch = async () => {
      dispatchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(
        JSON.stringify({ id: 'mov_conc', resultingOnHand: 5, resultingReserved: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const coordinator = new SyncCoordinator(db, transport);

    // Trigger two syncs concurrently
    const [res1, res2] = await Promise.all([
      coordinator.sync(contextA),
      coordinator.sync(contextA),
    ]);

    expect(dispatchCount).toBe(1); // Only one HTTP dispatch took place!
    expect(res1.acknowledged).toBe(1);
    expect(res2.acknowledged).toBe(1);

    await db.close();
  });
});
