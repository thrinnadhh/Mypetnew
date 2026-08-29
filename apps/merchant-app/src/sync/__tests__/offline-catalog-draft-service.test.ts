import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { createPartitionContext } from '../../data/models/partition-context';
import { OfflineCatalogDraftRepository } from '../../data/repositories/offline-catalog-draft-repository';
import { OfflineCatalogDraftService } from '../offline-catalog-draft-service';

describe('M7 OfflineCatalogDraftService', () => {
  const context = createPartitionContext('acc_queue', 'org_queue', 'out_queue');

  const input = {
    tempListingId: 'local_00000000-0000-4000-8000-000000000777',
    barcodeType: 'INTERNAL' as const,
    barcode: 'OFFLINE-QUEUE-1',
    name: 'Queued Offline Item',
    kind: 'PRODUCT' as const,
    mrpPaise: 1000,
    sellingPricePaise: 900,
    category: 'food',
    brand: null,
    description: null,
    petType: null,
    lifeStage: null,
    packLabel: null,
    sku: null,
  };

  it('atomically converges repeated queue calls to one durable create command', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const service = new OfflineCatalogDraftService(db, 'installation-m7');

    const first = await service.queueDraft(context, input);
    const second = await service.queueDraft(context, input);

    expect(first.draft.tempListingId).toBe(input.tempListingId);
    expect(first.command.commandType).toBe('CATALOG_CREATE');
    expect(second.command.commandId).toBe(first.command.commandId);
    expect(second.command.idempotencyKey).toBe(first.command.idempotencyKey);
    expect((await service.getDraftRepository().getDraft(context, input.tempListingId))?.state).toBe('QUEUED');
    expect(await service.getOutboxRepository?.()).toBeUndefined();

    const rows = await db.all<{ count: number }>(
      'SELECT COUNT(*) as count FROM offline_commands WHERE account_id = ? AND organization_id = ? AND outlet_id = ?',
      [context.accountId, context.organizationId, context.outletId],
    );
    expect(rows[0].count).toBe(1);
    await db.close();
  });

  it('recovers a process-death gap where draft persisted before outbox enqueue', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new OfflineCatalogDraftRepository(db);
    await drafts.createDraft(context, input);

    const service = new OfflineCatalogDraftService(db, 'installation-m7');
    expect(await service.recoverUnqueuedDrafts(context)).toBe(1);
    expect(await service.recoverUnqueuedDrafts(context)).toBe(0);

    const restored = await drafts.getDraft(context, input.tempListingId);
    expect(restored?.state).toBe('QUEUED');
    expect(restored?.createCommandId).toBeTruthy();
    const commands = await db.all<{ command_type: string; idempotency_key: string }>(
      'SELECT command_type, idempotency_key FROM offline_commands',
    );
    expect(commands).toHaveLength(1);
    expect(commands[0].command_type).toBe('CATALOG_CREATE');
    expect(commands[0].idempotency_key).toContain(input.tempListingId.replace('local_', ''));
    await db.close();
  });
});
