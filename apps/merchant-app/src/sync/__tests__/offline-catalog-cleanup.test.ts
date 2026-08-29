import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { OfflineCatalogDraftRepository } from '../../data/repositories/offline-catalog-draft-repository';
import { cleanupOfflineCatalogState } from '../offline-catalog-cleanup';

describe('M7 offline catalog cleanup', () => {
  const context = createPartitionContext('cleanup_acc', 'cleanup_org', 'cleanup_out');

  async function seedSyncedDraft(db: ReturnType<typeof createNodeSqliteDatabase>, suffix: string) {
    const drafts = new OfflineCatalogDraftRepository(db, () => Date.parse('2026-08-01T00:00:00Z'));
    const outbox = new CommandOutboxRepository(db, () => Date.parse('2026-08-01T00:00:00Z'));
    const tempListingId = `local_00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
    await drafts.createDraft(context, {
      tempListingId,
      barcodeType: 'INTERNAL',
      barcode: `CLEAN-${suffix}`,
      name: `Cleanup ${suffix}`,
      kind: 'PRODUCT',
      mrpPaise: 1000,
      sellingPricePaise: 900,
      category: 'food',
    });
    const command = await outbox.enqueueCommand(context, {
      commandId: `cleanup-command-${suffix}`,
      idempotencyKey: `cleanup-key-${suffix}`,
      commandType: 'CATALOG_CREATE',
      payload: {
        tempListingId,
        outletId: context.outletId,
        barcodeType: 'INTERNAL',
        barcode: `CLEAN-${suffix}`,
        name: `Cleanup ${suffix}`,
        kind: 'PRODUCT',
        mrpPaise: 1000,
        sellingPricePaise: 900,
        category: 'food',
      },
    });
    await drafts.applyCreateReceipt(context, command, {
      receiptId: `77777777-7777-4777-8777-${suffix.padStart(12, '0')}`,
      serverTimestamp: '2026-08-01T00:00:00Z',
      rawResponse: {
        outcome: 'CREATED',
        canonicalListingId: `77777777-7777-4777-8777-${suffix.padStart(12, '0')}`,
      },
    });
    return { drafts, tempListingId };
  }

  it('deletes only old synced copies and terminal media while retaining canonical mapping', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const { drafts, tempListingId } = await seedSyncedDraft(db, '801');
    const media = await drafts.enqueueMediaJob(context, {
      tempListingId,
      filename: 'done.jpg',
      contentType: 'image/jpeg',
      bytesBase64: 'AA==',
      sizeBytes: 1,
      idempotencyKey: 'cleanup-media-1',
    });
    await drafts.markMediaAcknowledged(context, media.mediaJobId);

    const result = await cleanupOfflineCatalogState(db, context, '2026-08-15T00:00:00Z');
    expect(result).toEqual({ terminalMediaJobsDeleted: 1, syncedDraftsDeleted: 1 });
    expect(await drafts.getDraft(context, tempListingId)).toBeNull();
    expect((await drafts.getMapping(context, tempListingId))?.canonicalListingId).toContain('77777777');
    await db.close();
  });

  it('never deletes conflict or rejected drafts and retains synced draft with retryable media', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const { drafts, tempListingId } = await seedSyncedDraft(db, '802');
    const media = await drafts.enqueueMediaJob(context, {
      tempListingId,
      filename: 'retry.png',
      contentType: 'image/png',
      bytesBase64: 'AA==',
      sizeBytes: 1,
      idempotencyKey: 'cleanup-media-retry',
    });
    await drafts.markMediaRetryable(context, media.mediaJobId, 'NETWORK_ERROR');

    const conflictId = 'local_00000000-0000-4000-8000-000000000803';
    await drafts.createDraft(context, {
      tempListingId: conflictId,
      barcodeType: 'INTERNAL',
      barcode: 'CONFLICT-CLEAN',
      name: 'Keep Conflict',
      kind: 'PRODUCT',
      mrpPaise: 500,
      sellingPricePaise: 450,
      category: 'food',
    });
    const outbox = new CommandOutboxRepository(db);
    const conflictCommand = await outbox.enqueueCommand(context, {
      commandId: 'cleanup-conflict-command',
      idempotencyKey: 'cleanup-conflict-key',
      commandType: 'CATALOG_CREATE',
      payload: {
        tempListingId: conflictId,
        outletId: context.outletId,
        barcodeType: 'INTERNAL',
        barcode: 'CONFLICT-CLEAN',
        name: 'Keep Conflict',
        kind: 'PRODUCT',
        mrpPaise: 500,
        sellingPricePaise: 450,
        category: 'food',
      },
    });
    await drafts.markCreateConflict(context, conflictCommand, { outcome: 'CONFLICT' });

    const result = await cleanupOfflineCatalogState(db, context, '2026-09-01T00:00:00Z');
    expect(result.syncedDraftsDeleted).toBe(0);
    expect((await drafts.getDraft(context, tempListingId))?.state).toBe('SYNCED');
    expect((await drafts.getDraft(context, conflictId))?.state).toBe('CONFLICT');
    expect((await drafts.getMediaJob(context, media.mediaJobId))?.state).toBe('RETRYABLE');
    await db.close();
  });
});
