import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { CommandOutboxRepository } from '../command-outbox-repository';

describe('M6 CommandOutboxRepository', () => {
  const contextA = createPartitionContext('acc_1', 'org_1', 'out_1');
  const contextB = createPartitionContext('acc_2', 'org_2', 'out_2');

  it('queues a command and enforces immutability on re-enqueue', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    const cmd1 = await repo.enqueueCommand(contextA, {
      commandId: 'cmd_1',
      installationId: 'inst_1',
      idempotencyKey: 'idem_1',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: 'out_1',
        listingId: 'list_1',
        quantityDelta: 5,
        reason: 'MANUAL_INCREASE',
      },
    });

    expect(cmd1.commandId).toBe('cmd_1');
    expect(cmd1.state).toBe('PENDING');
    expect(cmd1.attemptCount).toBe(0);

    // Re-enqueueing identical command is idempotent
    const cmd1Duplicate = await repo.enqueueCommand(contextA, {
      commandId: 'cmd_1',
      installationId: 'inst_1',
      idempotencyKey: 'idem_1',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: 'out_1',
        listingId: 'list_1',
        quantityDelta: 5,
        reason: 'MANUAL_INCREASE',
      },
    });
    expect(cmd1Duplicate.commandId).toBe('cmd_1');

    // Attempting to re-enqueue same commandId with different payload throws COMMAND_IMMUTABILITY_VIOLATION
    await expect(
      repo.enqueueCommand(contextA, {
        commandId: 'cmd_1',
        installationId: 'inst_1',
        idempotencyKey: 'idem_1',
        commandType: 'INVENTORY_ADJUSTMENT',
        payload: {
          outletId: 'out_1',
          listingId: 'list_1',
          quantityDelta: 10, // Changed!
          reason: 'MANUAL_INCREASE',
        },
      }),
    ).rejects.toThrow('COMMAND_IMMUTABILITY_VIOLATION');

    // Attempting to reuse same idempotency key with different payload throws IDEMPOTENCY_FINGERPRINT_MISMATCH
    await expect(
      repo.enqueueCommand(contextA, {
        commandId: 'cmd_2',
        installationId: 'inst_1',
        idempotencyKey: 'idem_1', // Reused!
        commandType: 'INVENTORY_ADJUSTMENT',
        payload: {
          outletId: 'out_1',
          listingId: 'list_1',
          quantityDelta: 10,
          reason: 'MANUAL_INCREASE',
        },
      }),
    ).rejects.toThrow('IDEMPOTENCY_FINGERPRINT_MISMATCH');

    await db.close();
  });

  it('detects and rejects dependency cycles (self and multi-hop)', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    // Self dependency
    await expect(
      repo.enqueueCommand(contextA, {
        commandId: 'cmd_self',
        installationId: 'inst_1',
        idempotencyKey: 'idem_self',
        commandType: 'INVENTORY_ADJUSTMENT',
        payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 1, reason: 'MANUAL_INCREASE' },
        dependsOnCommandIds: ['cmd_self'],
      }),
    ).rejects.toThrow('COMMAND_DEPENDENCY_CYCLE');

    // Chain: A -> B -> C -> A
    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_A',
      installationId: 'inst_1',
      idempotencyKey: 'idem_A',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 1, name: 'A', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
    });

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_B',
      installationId: 'inst_1',
      idempotencyKey: 'idem_B',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 2, name: 'B', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
      dependsOnCommandIds: ['cmd_A'],
    });

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_C',
      installationId: 'inst_1',
      idempotencyKey: 'idem_C',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 3, name: 'C', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
      dependsOnCommandIds: ['cmd_B'],
    });

    // Enqueueing D depending on C is fine
    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_D',
      installationId: 'inst_1',
      idempotencyKey: 'idem_D',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 4, name: 'D', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
      dependsOnCommandIds: ['cmd_C'],
    });

    await db.close();
  });

  it('enforces dependency blocking until parent is ACKNOWLEDGED and cascades BLOCKED on parent rejection', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    await repo.enqueueCommand(contextA, {
      commandId: 'parent_cmd',
      installationId: 'inst_1',
      idempotencyKey: 'idem_parent',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 1, name: 'P', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
    });

    await repo.enqueueCommand(contextA, {
      commandId: 'child_cmd',
      installationId: 'inst_1',
      idempotencyKey: 'idem_child',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 5, reason: 'MANUAL_INCREASE' },
      dependsOnCommandIds: ['parent_cmd'],
    });

    // Only parent is eligible
    const claimed1 = await repo.claimNextEligibleCommands(contextA, 'worker_1', 30000, 10);
    expect(claimed1.length).toBe(1);
    expect(claimed1[0].command.commandId).toBe('parent_cmd');

    // Child is still not eligible
    const claimed2 = await repo.claimNextEligibleCommands(contextA, 'worker_1', 30000, 10);
    expect(claimed2.length).toBe(0);

    // Reject parent
    await repo.markRejected(contextA, 'parent_cmd', 'VALIDATION_FAILED', 'Invalid listing');

    // Re-evaluating claims marks child as BLOCKED
    const claimed3 = await repo.claimNextEligibleCommands(contextA, 'worker_1', 30000, 10);
    expect(claimed3.length).toBe(0);

    const childRecord = await repo.getCommand(contextA, 'child_cmd');
    expect(childRecord?.state).toBe('BLOCKED');
    expect(childRecord?.lastErrorCode).toBe('PARENT_COMMAND_REJECTED');

    await db.close();
  });

  it('maintains strict partition isolation between accounts and outlets', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_A',
      installationId: 'inst_1',
      idempotencyKey: 'idem_A',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 1, reason: 'MANUAL_INCREASE' },
    });

    await repo.enqueueCommand(contextB, {
      commandId: 'cmd_B',
      installationId: 'inst_2',
      idempotencyKey: 'idem_B',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_2', listingId: 'list_2', quantityDelta: 2, reason: 'MANUAL_INCREASE' },
    });

    // Worker claiming for contextA only gets cmd_A
    const claimsA = await repo.claimNextEligibleCommands(contextA, 'worker_A', 30000, 10);
    expect(claimsA.length).toBe(1);
    expect(claimsA[0].command.commandId).toBe('cmd_A');

    // Worker claiming for contextB only gets cmd_B
    const claimsB = await repo.claimNextEligibleCommands(contextB, 'worker_B', 30000, 10);
    expect(claimsB.length).toBe(1);
    expect(claimsB[0].command.commandId).toBe('cmd_B');

    await db.close();
  });

  it('recovers expired SENDING leases safely back to RETRYABLE', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_lease',
      installationId: 'inst_1',
      idempotencyKey: 'idem_lease',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 1, reason: 'MANUAL_INCREASE' },
    });

    // Claim with very short lease (10ms)
    const claimed = await repo.claimNextEligibleCommands(contextA, 'worker_1', 10, 10);
    expect(claimed.length).toBe(1);
    expect(claimed[0].command.state).toBe('SENDING');

    // Wait for lease to expire
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Next claim recovers stale lease and re-claims it
    const reclaimed = await repo.claimNextEligibleCommands(contextA, 'worker_2', 30000, 10);
    expect(reclaimed.length).toBe(1);
    expect(reclaimed[0].command.commandId).toBe('cmd_lease');
    expect(reclaimed[0].command.attemptCount).toBe(2);

    await db.close();
  });

  it('rejects unsupported command payload schema versions on enqueue', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    await expect(
      repo.enqueueCommand(contextA, {
        commandId: 'cmd_v99',
        installationId: 'inst_1',
        idempotencyKey: 'idem_v99',
        commandType: 'INVENTORY_ADJUSTMENT',
        payloadSchemaVersion: 99, // Unsupported!
        payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 1, reason: 'MANUAL_INCREASE' },
      }),
    ).rejects.toThrow('COMMAND_SCHEMA_UNSUPPORTED');

    await db.close();
  });

  it('rejects dependency when parent command does not exist in partition', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    // Parent in different partition
    await repo.enqueueCommand(contextB, {
      commandId: 'cmd_parent_B',
      installationId: 'inst_2',
      idempotencyKey: 'idem_parent_B',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: 'out_2', listingId: 'list_2', quantityDelta: 1, reason: 'MANUAL_INCREASE' },
    });

    // Enqueueing child in contextA depending on cmd_parent_B (foreign partition) fails closed
    await expect(
      repo.enqueueCommand(contextA, {
        commandId: 'cmd_child_A',
        installationId: 'inst_1',
        idempotencyKey: 'idem_child_A',
        commandType: 'INVENTORY_ADJUSTMENT',
        payload: { outletId: 'out_1', listingId: 'list_1', quantityDelta: 1, reason: 'MANUAL_INCREASE' },
        dependsOnCommandIds: ['cmd_parent_B'],
      }),
    ).rejects.toThrow('COMMAND_DEPENDENCY_NOT_FOUND');

    await db.close();
  });

  it('cascades BLOCKED status transitively through deep dependency chains (A -> B -> C -> D)', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_A',
      installationId: 'inst_1',
      idempotencyKey: 'idem_A',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 1, name: 'A', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
    });

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_B',
      installationId: 'inst_1',
      idempotencyKey: 'idem_B',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 2, name: 'B', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
      dependsOnCommandIds: ['cmd_A'],
    });

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_C',
      installationId: 'inst_1',
      idempotencyKey: 'idem_C',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 3, name: 'C', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
      dependsOnCommandIds: ['cmd_B'],
    });

    await repo.enqueueCommand(contextA, {
      commandId: 'cmd_D',
      installationId: 'inst_1',
      idempotencyKey: 'idem_D',
      commandType: 'CATALOG_UPDATE',
      payload: { outletId: 'out_1', listingId: 'list_1', expectedVersion: 4, name: 'D', mrpPaise: 100, sellingPricePaise: 100, category: 'food' },
      dependsOnCommandIds: ['cmd_C'],
    });

    // When root A is rejected, markRejected recursively cascades BLOCKED to B, C, and D
    await repo.markRejected(contextA, 'cmd_A', 'PERMISSION_DENIED', 'Root permission revoked');

    const cmdB = await repo.getCommand(contextA, 'cmd_B');
    const cmdC = await repo.getCommand(contextA, 'cmd_C');
    const cmdD = await repo.getCommand(contextA, 'cmd_D');

    expect(cmdB?.state).toBe('BLOCKED');
    expect(cmdC?.state).toBe('BLOCKED');
    expect(cmdD?.state).toBe('BLOCKED');

    // No pending or retryable commands left to claim
    const claimed = await repo.claimNextEligibleCommands(contextA, 'worker_1', 30000, 10);
    expect(claimed.length).toBe(0);

    await db.close();
  });
});
