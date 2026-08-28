import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { SyncCoordinator } from '../sync-coordinator';
import { SyncTransport } from '../sync-transport';
import { SyncRetryPolicy } from '../retry-policy';

describe('M6 Production-Component Connected Unknown-Outcome & ACK-Write-Loss Hardening', () => {
  const context = createPartitionContext('acc_conn_test', 'org_conn_test', 'out_conn_test');
  let tempDbDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mypet-conn-test-'));
    tempDbPath = path.join(tempDbDir, 'production_sync_test.db');
  });

  afterEach(() => {
    if (fs.existsSync(tempDbDir)) {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    }
  });

  it('Scenario 1: Real Connected Unknown Outcome (production outbox -> controller commit -> network drop -> restart -> receipt resolver -> ACK)', async () => {
    let mockTime = 1000000;
    const clock = () => mockTime;

    // Phase 1: Real SQLite file with production migrations
    const db1 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db1);
    const outboxRepo1 = new CommandOutboxRepository(db1);

    const cmd = await outboxRepo1.enqueueCommand(context, {
      commandType: 'INVENTORY_ADJUSTMENT',
      payloadSchemaVersion: 1,
      payload: {
        outletId: context.outletId,
        listingId: 'item_conn_uo_1',
        quantityDelta: 15,
        reason: 'MANUAL_INCREASE',
      },
      idempotencyKey: 'idemp_conn_uo_101',
    });

    expect(cmd.state).toBe('PENDING');

    // Server ledger simulation (representing PostgreSQL state)
    const serverMovements: Array<{ id: string; key: string; delta: number }> = [];
    const serverReceipts: Map<string, { receiptId: string; resultingOnHand: number; version: number }> = new Map();
    let serverOnHandBalance = 0;
    let dispatchCallCount = 0;
    let resolveCallCount = 0;

    let shouldDropResponse = true;

    const mockFetch = async (url: string, options?: RequestInit) => {
      if (url.includes('/api/v1/merchant/inventory/adjustments')) {
        dispatchCallCount += 1;
        const body = JSON.parse(options?.body as string);
        // Server processes and commits transaction
        serverOnHandBalance += body.quantityDelta;
        const movId = `mov_${serverMovements.length + 1}`;
        serverMovements.push({ id: movId, key: 'idemp_conn_uo_101', delta: body.quantityDelta });
        serverReceipts.set('idemp_conn_uo_101', {
          receiptId: movId,
          resultingOnHand: serverOnHandBalance,
          version: serverMovements.length,
        });

        if (shouldDropResponse) {
          // Intentionally lose response AFTER server commit
          throw new Error('Socket closed remotely after HTTP response was generated');
        }

        return new Response(
          JSON.stringify({ id: movId, resultingOnHand: serverOnHandBalance }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/v1/merchant/sync/receipts/resolve')) {
        resolveCallCount += 1;
        const body = JSON.parse(options?.body as string);
        const receipt = serverReceipts.get(body.idempotencyKey);
        if (receipt) {
          return new Response(
            JSON.stringify({
              status: 'ACCEPTED',
              receiptId: receipt.receiptId,
              commandType: 'INVENTORY_ADJUSTMENT',
              entityId: body.payload.listingId,
              resultingOnHand: receipt.resultingOnHand,
              resultingVersion: receipt.version,
              serverTimestamp: new Date(clock()).toISOString(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: 'No receipt found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 404 });
    };

    // First dispatch attempt with response loss
    const coordinator1 = new SyncCoordinator(
      db1,
      new SyncTransport(mockFetch),
      new SyncRetryPolicy({ clock }),
      undefined,
      'worker-1',
      clock,
    );
    const summary1 = await coordinator1.sync(context);

    expect(dispatchCallCount).toBe(1);
    expect(summary1.retryable).toBe(1);
    expect(summary1.acknowledged).toBe(0);

    // Command in SQLite is retryable / unresolved, NOT acknowledged
    const unackCmd = await outboxRepo1.getCommand(context, cmd.commandId);
    expect(unackCmd?.state).toBe('RETRYABLE');
    expect(unackCmd?.durableServerReceipt).toBeFalsy();

    // Close SQLite database
    await db1.close();

    // Advance clock past retry backoff window (e.g. 5 seconds)
    mockTime += 5000;

    // Phase 2: Process restarts -> reopen same SQLite file using production database bootstrap
    const db2 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db2);
    const outboxRepo2 = new CommandOutboxRepository(db2);

    shouldDropResponse = false; // Network restored
    const coordinator2 = new SyncCoordinator(
      db2,
      new SyncTransport(mockFetch),
      new SyncRetryPolicy({ clock }),
      undefined,
      'worker-2',
      clock,
    );
    const summary2 = await coordinator2.sync(context);

    // Command recovered through receipt resolver, marked ACKNOWLEDGED
    expect(resolveCallCount).toBe(1);
    expect(dispatchCallCount).toBe(1); // ZERO second mutation dispatch!
    expect(summary2.acknowledged).toBe(1);

    const finalCmd = await outboxRepo2.getCommand(context, cmd.commandId);
    expect(finalCmd?.state).toBe('ACKNOWLEDGED');
    expect(finalCmd?.durableServerReceipt).toBeDefined();

    // Verify server invariants: strictly singular effect
    expect(serverMovements.length).toBe(1);
    expect(serverReceipts.size).toBe(1);
    expect(serverOnHandBalance).toBe(15);

    await db2.close();
  });

  it('Scenario 2: Real ACK-Write-Loss Failure Injection (server commits -> client receives -> SQLite markAcknowledged fails -> restart -> recovers)', async () => {
    let mockTime = 2000000;
    const clock = () => mockTime;

    const db1 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db1);
    const outboxRepo1 = new CommandOutboxRepository(db1);

    const cmd = await outboxRepo1.enqueueCommand(context, {
      commandType: 'INVENTORY_ADJUSTMENT',
      payloadSchemaVersion: 1,
      payload: {
        outletId: context.outletId,
        listingId: 'item_ack_loss_1',
        quantityDelta: 20,
        reason: 'MANUAL_INCREASE',
      },
      idempotencyKey: 'idemp_ack_loss_202',
    });

    const serverMovements: Array<{ id: string; key: string; delta: number }> = [];
    const serverReceipts: Map<string, { receiptId: string; resultingOnHand: number; version: number }> = new Map();
    let serverOnHandBalance = 0;
    let dispatchCallCount = 0;
    let resolveCallCount = 0;

    const mockFetch = async (url: string, options?: RequestInit) => {
      if (url.includes('/api/v1/merchant/inventory/adjustments')) {
        dispatchCallCount += 1;
        const body = JSON.parse(options?.body as string);
        serverOnHandBalance += body.quantityDelta;
        const movId = `mov_ack_${serverMovements.length + 1}`;
        serverMovements.push({ id: movId, key: 'idemp_ack_loss_202', delta: body.quantityDelta });
        serverReceipts.set('idemp_ack_loss_202', {
          receiptId: movId,
          resultingOnHand: serverOnHandBalance,
          version: serverMovements.length,
        });

        return new Response(
          JSON.stringify({ id: movId, resultingOnHand: serverOnHandBalance }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/v1/merchant/sync/receipts/resolve')) {
        resolveCallCount += 1;
        const body = JSON.parse(options?.body as string);
        const receipt = serverReceipts.get(body.idempotencyKey);
        if (receipt) {
          return new Response(
            JSON.stringify({
              status: 'ACCEPTED',
              receiptId: receipt.receiptId,
              commandType: 'INVENTORY_ADJUSTMENT',
              entityId: body.payload.listingId,
              resultingOnHand: receipt.resultingOnHand,
              resultingVersion: receipt.version,
              serverTimestamp: new Date(clock()).toISOString(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: 'No receipt found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 404 });
    };

    // INJECT FAULT: Intercept db1.run during markAcknowledged to simulate I/O failure or process crash
    const originalRun = db1.run.bind(db1);
    let faultInjected = false;
    db1.run = async (sql: string, params?: unknown[]) => {
      if (sql.includes("state = 'ACKNOWLEDGED'") && !faultInjected) {
        faultInjected = true;
        throw new Error('SQLITE_IOERR: Simulated disk I/O failure during markAcknowledged commit');
      }
      return originalRun(sql, params);
    };

    const coordinator1 = new SyncCoordinator(
      db1,
      new SyncTransport(mockFetch),
      new SyncRetryPolicy({ clock }),
      undefined,
      'worker-1',
      clock,
    );

    // Expect sync to fail or catch the injected DB commit error
    await coordinator1.sync(context).catch(() => null);

    // Close db1
    await db1.close();

    // Advance time by 35s to simulate lease expiration upon restart
    mockTime += 35000;

    // Phase 2: Process restarts, reopens database
    const db2 = createNodeSqliteDatabase(tempDbPath);
    await new DatabaseBootstrapper().bootstrap(db2);
    const outboxRepo2 = new CommandOutboxRepository(db2);

    const coordinator2 = new SyncCoordinator(
      db2,
      new SyncTransport(mockFetch),
      new SyncRetryPolicy({ clock }),
      undefined,
      'worker-2',
      clock,
    );
    const summary2 = await coordinator2.sync(context);

    expect(resolveCallCount).toBe(1);
    expect(dispatchCallCount).toBe(1); // ZERO second mutation dispatch!
    expect(summary2.acknowledged).toBe(1);

    const finalCmd = await outboxRepo2.getCommand(context, cmd.commandId);
    expect(finalCmd?.state).toBe('ACKNOWLEDGED');
    expect(finalCmd?.durableServerReceipt).toBeDefined();

    // Verify strictly 1 server effect
    expect(serverMovements.length).toBe(1);
    expect(serverOnHandBalance).toBe(20);

    await db2.close();
  });
});
