import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { CommandOutboxRepository } from '../command-outbox-repository';
import { OfflineCatalogDraftRepository } from '../offline-catalog-draft-repository';

describe('M7 OfflineCatalogDraftRepository', () => {
  const context = createPartitionContext('acc_m7', 'org_m7', 'out_m7');
  const foreignContext = createPartitionContext('acc_other', 'org_other', 'out_other');

  function draftInput() {
    return {
      tempListingId: 'local_00000000-0000-4000-8000-000000000701',
      barcodeType: 'INTERNAL' as const,
      barcode: 'OFF-M7-001',
      name: 'Offline Draft Product',
      kind: 'PRODUCT' as const,
      mrpPaise: 12000,
      sellingPricePaise: 11000,
      category: 'food',
      brand: 'MyPet',
      description: 'Captured while offline',
      petType: 'DOG',
      lifeStage: null,
      packLabel: '1 kg',
      sku: 'M7-OFF-1',
    };
  }

  it('survives process death and preserves partition isolation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mypet-m7-draft-'));
    const dbPath = path.join(dir, 'merchant.db');
    try {
      const db1 = createNodeSqliteDatabase(dbPath);
      await new DatabaseBootstrapper().bootstrap(db1);
      const repo1 = new OfflineCatalogDraftRepository(db1);
      const created = await repo1.createDraft(context, draftInput());
      expect(created.state).toBe('LOCAL_DRAFT');
      expect(created.tempListingId).toBe(draftInput().tempListingId);
      await db1.close();

      const db2 = createNodeSqliteDatabase(dbPath);
      await new DatabaseBootstrapper().bootstrap(db2);
      const repo2 = new OfflineCatalogDraftRepository(db2);
      const restored = await repo2.getDraft(context, draftInput().tempListingId);
      expect(restored?.name).toBe('Offline Draft Product');
      expect(restored?.state).toBe('LOCAL_DRAFT');
      expect(await repo2.getDraft(foreignContext, draftInput().tempListingId)).toBeNull();
      await db2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores canonical mapping before dependent command dispatch and retargets temp listing id', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new OfflineCatalogDraftRepository(db);
    const outbox = new CommandOutboxRepository(db);
    const draft = await drafts.createDraft(context, draftInput());

    const createCommand = await outbox.enqueueCommand(context, {
      commandId: 'm7_create_1',
      installationId: 'm7_installation',
      idempotencyKey: 'm7:create:1',
      commandType: 'CATALOG_CREATE',
      payload: { ...draftInput(), outletId: context.outletId },
    });
    await drafts.attachCreateCommand(context, draft.tempListingId, createCommand.commandId);

    const dependent = await outbox.enqueueCommand(context, {
      commandId: 'm7_inventory_1',
      installationId: 'm7_installation',
      idempotencyKey: 'm7:inventory:1',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: context.outletId,
        listingId: draft.tempListingId,
        quantityDelta: 5,
        reason: 'MANUAL_INCREASE',
      },
      dependsOnCommandIds: [createCommand.commandId],
    });

    expect((JSON.parse((await drafts.resolveCommandIdentity(context, dependent)).payloadJson) as { listingId: string }).listingId)
      .toBe(draft.tempListingId);

    await drafts.applyCreateReceipt(context, createCommand, {
      receiptId: '11111111-1111-4111-8111-111111111111',
      resultingVersion: 0,
      serverTimestamp: '2026-08-29T00:00:00.000Z',
      rawResponse: {
        outcome: 'CREATED',
        canonicalListingId: '11111111-1111-4111-8111-111111111111',
      },
    });

    const mapping = await drafts.getMapping(context, draft.tempListingId);
    expect(mapping).toMatchObject({
      canonicalListingId: '11111111-1111-4111-8111-111111111111',
      outcome: 'CREATED',
    });
    expect((await drafts.getDraft(context, draft.tempListingId))?.state).toBe('SYNCED');

    const effective = await drafts.resolveCommandIdentity(context, dependent);
    const effectivePayload = JSON.parse(effective.payloadJson) as { listingId: string; quantityDelta: number };
    expect(effectivePayload.listingId).toBe('11111111-1111-4111-8111-111111111111');
    expect(effectivePayload.quantityDelta).toBe(5);
    expect(effective.idempotencyKey).toBe(dependent.idempotencyKey);
    expect(dependent.payloadJson).toContain(draft.tempListingId);

    await db.close();
  });

  it('retargets durable media jobs after create receipt without losing local bytes', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new OfflineCatalogDraftRepository(db);
    const outbox = new CommandOutboxRepository(db);
    const draft = await drafts.createDraft(context, draftInput());
    const media = await drafts.enqueueMediaJob(context, {
      tempListingId: draft.tempListingId,
      filename: 'draft.jpg',
      contentType: 'image/jpeg',
      bytesBase64: 'AAECAwQ=',
      sizeBytes: 5,
      idempotencyKey: 'm7:media:1',
    });
    expect(media.canonicalListingId).toBeNull();
    expect(await drafts.claimMediaJobs(context)).toEqual([]);

    const createCommand = await outbox.enqueueCommand(context, {
      commandId: 'm7_create_media',
      idempotencyKey: 'm7:create:media',
      commandType: 'CATALOG_CREATE',
      payload: { ...draftInput(), outletId: context.outletId },
    });
    await drafts.applyCreateReceipt(context, createCommand, {
      receiptId: '22222222-2222-4222-8222-222222222222',
      resultingVersion: 0,
      serverTimestamp: '2026-08-29T00:00:00.000Z',
      rawResponse: {
        outcome: 'EXISTING_LISTING',
        canonicalListingId: '22222222-2222-4222-8222-222222222222',
      },
    });

    const claimed = await drafts.claimMediaJobs(context);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      mediaJobId: media.mediaJobId,
      canonicalListingId: '22222222-2222-4222-8222-222222222222',
      bytesBase64: 'AAECAwQ=',
      state: 'UPLOADING',
      attemptCount: 1,
    });
    await db.close();
  });

  it('recovers expired media upload lease and preserves retry identity', async () => {
    let now = Date.parse('2026-08-29T00:00:00.000Z');
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new OfflineCatalogDraftRepository(db, () => now);
    const outbox = new CommandOutboxRepository(db, () => now);
    const draft = await drafts.createDraft(context, draftInput());
    const createCommand = await outbox.enqueueCommand(context, {
      commandId: 'm7_create_lease',
      idempotencyKey: 'm7:create:lease',
      commandType: 'CATALOG_CREATE',
      payload: { ...draftInput(), outletId: context.outletId },
    });
    await drafts.applyCreateReceipt(context, createCommand, {
      receiptId: '33333333-3333-4333-8333-333333333333',
      serverTimestamp: new Date(now).toISOString(),
      rawResponse: { canonicalListingId: '33333333-3333-4333-8333-333333333333', outcome: 'CREATED' },
    });
    const media = await drafts.enqueueMediaJob(context, {
      tempListingId: draft.tempListingId,
      filename: 'lease.webp',
      contentType: 'image/webp',
      bytesBase64: 'UklGRgAAAABXRUJQ',
      sizeBytes: 12,
      idempotencyKey: 'm7:media:lease',
    });

    expect((await drafts.claimMediaJobs(context))[0].state).toBe('UPLOADING');
    now += 31_000;
    const reclaimed = await drafts.claimMediaJobs(context);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].mediaJobId).toBe(media.mediaJobId);
    expect(reclaimed[0].idempotencyKey).toBe('m7:media:lease');
    expect(reclaimed[0].attemptCount).toBe(2);
    await db.close();
  });

  it('records explicit conflict and rejection states without deleting draft metadata', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new OfflineCatalogDraftRepository(db);
    const outbox = new CommandOutboxRepository(db);
    await drafts.createDraft(context, draftInput());
    const command = await outbox.enqueueCommand(context, {
      commandId: 'm7_create_conflict',
      idempotencyKey: 'm7:create:conflict',
      commandType: 'CATALOG_CREATE',
      payload: { ...draftInput(), outletId: context.outletId },
    });

    await drafts.markCreateConflict(context, command, {
      outcome: 'CONFLICT',
      canonicalListingId: '44444444-4444-4444-8444-444444444444',
    });
    let restored = await drafts.getDraft(context, draftInput().tempListingId);
    expect(restored?.state).toBe('CONFLICT');
    expect(restored?.name).toBe('Offline Draft Product');
    expect(restored?.conflictJson).toContain('canonicalListingId');

    await drafts.markCreateRejected(context, command, 'PERMISSION_DENIED');
    restored = await drafts.getDraft(context, draftInput().tempListingId);
    expect(restored?.state).toBe('REJECTED');
    expect(restored?.lastErrorCode).toBe('PERMISSION_DENIED');
    expect(restored?.name).toBe('Offline Draft Product');
    await db.close();
  });
});
