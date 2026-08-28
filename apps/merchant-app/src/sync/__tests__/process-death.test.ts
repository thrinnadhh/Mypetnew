import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { DatabaseRecoveryManager } from '../../data/database/recovery';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { SyncCoordinator } from '../sync-coordinator';
import { SyncTransport } from '../sync-transport';

describe('M6 Process Death & Persistence Hardening Matrix', () => {
  const context = createPartitionContext('acc_death', 'org_death', 'out_death');
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `mypet_death_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('Scenario A: Queue command -> process dies -> reopen DB -> command exists -> replay succeeds', async () => {
    // Phase 1: Queue command in temporary database file
    const db1 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db1);
    const repo1 = new CommandOutboxRepository(db1);

    await repo1.enqueueCommand(context, {
      commandId: 'cmd_persist_1',
      installationId: 'inst_1',
      idempotencyKey: 'idem_persist_1',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: context.outletId, listingId: 'list_1', quantityDelta: 5, reason: 'MANUAL_INCREASE' },
    });

    // Simulate process death / shutdown
    await db1.close();

    // Phase 2: Reopen brand new database instance from disk
    const db2 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db2);
    const repo2 = new CommandOutboxRepository(db2);

    const recoveredCmd = await repo2.getCommand(context, 'cmd_persist_1');
    expect(recoveredCmd).not.toBeNull();
    expect(recoveredCmd?.state).toBe('PENDING');

    // Sync succeeds
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({ id: 'mov_p1', resultingOnHand: 15, resultingReserved: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const coordinator = new SyncCoordinator(db2, new SyncTransport(mockFetch));
    const summary = await coordinator.sync(context);

    expect(summary.acknowledged).toBe(1);

    const ackCmd = await repo2.getCommand(context, 'cmd_persist_1');
    expect(ackCmd?.state).toBe('ACKNOWLEDGED');

    await db2.close();
  });

  it('Scenario B: Mark SENDING -> process dies -> reopen DB -> stale SENDING recovered and acknowledged', async () => {
    const db1 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db1);
    const repo1 = new CommandOutboxRepository(db1);

    await repo1.enqueueCommand(context, {
      commandId: 'cmd_sending_crash',
      installationId: 'inst_1',
      idempotencyKey: 'idem_sending_crash',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: context.outletId, listingId: 'list_1', quantityDelta: 5, reason: 'MANUAL_INCREASE' },
    });

    // Claim with lease that expires in past (simulating crash)
    const claimed = await repo1.claimNextEligibleCommands(context, 'worker_dead', 1, 10);
    expect(claimed[0].command.state).toBe('SENDING');

    await db1.close();

    // Reopen DB on restart
    const db2 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db2);
    const repo2 = new CommandOutboxRepository(db2);

    // Stale lease is recovered
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({ id: 'mov_recovered', resultingOnHand: 20, resultingReserved: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const coordinator = new SyncCoordinator(db2, new SyncTransport(mockFetch));
    const summary = await coordinator.sync(context);

    expect(summary.acknowledged).toBe(1);
    const finalCmd = await repo2.getCommand(context, 'cmd_sending_crash');
    expect(finalCmd?.state).toBe('ACKNOWLEDGED');

    await db2.close();
  });

  it('Scenario F: Projection recovery corruption reset NEVER erases the offline command outbox', async () => {
    const db = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db);
    const repo = new CommandOutboxRepository(db);

    await repo.enqueueCommand(context, {
      commandId: 'cmd_unresolved',
      installationId: 'inst_1',
      idempotencyKey: 'idem_unresolved',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: context.outletId, listingId: 'list_1', quantityDelta: 10, reason: 'MANUAL_INCREASE' },
    });

    // Trigger projection corruption recovery
    const recoveryManager = new DatabaseRecoveryManager();
    await recoveryManager.recoverProjectionDatabase(db, new Error('SQLITE_CORRUPT projection index'));

    // Verify projection schema re-migrated to version 3
    const version = await db.get<{ user_version: number }>('PRAGMA user_version;');
    expect(version?.user_version).toBe(3);

    // CRITICAL INVARIANT: The unresolved offline command survived without being destroyed!
    const preservedCmd = await repo.getCommand(context, 'cmd_unresolved');
    expect(preservedCmd).not.toBeNull();
    expect(preservedCmd?.commandId).toBe('cmd_unresolved');
    expect(preservedCmd?.state).toBe('PENDING');

    await db.close();
  });
});
