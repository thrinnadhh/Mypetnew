import { DatabaseBootstrapper } from '../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../data/database/node-driver';
import { createPartitionContext } from '../data/models/partition-context';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import { DraftLocalRepository } from '../data/repositories/draft-local-repository';
import { PendingMediaRepository } from '../data/repositories/pending-media-repository';
import { DraftSyncReconciler } from '../sync/draft-sync-reconciler';

describe('M0–M7 Merchant App Offline Recovery & Adversarial Flow Certification', () => {
  const contextA = createPartitionContext('acc-cert-1', 'org-cert-1', 'outlet-cert-1');

  it('Flow Groups R & T - Temporary ID boundary safety and blocked/rejected child command isolation during remap', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const drafts = new DraftLocalRepository(db);
    const outbox = new CommandOutboxRepository(db);
    const reconciler = new DraftSyncReconciler(db);

    // 1. Create a draft
    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Safe Remap Product',
      kind: 'PRODUCT',
      mrpPaise: 10000,
      sellingPricePaise: 9000,
    });

    const parentCmdId = await drafts.queueForSync(contextA, draft.localId, outbox, 'install-1');

    // 2. Enqueue child command 1 (valid dependency)
    await outbox.enqueueCommand(contextA, {
      commandId: 'child-valid-1',
      installationId: 'install-1',
      idempotencyKey: 'child-valid-1',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: contextA.outletId,
        listingId: draft.localId,
        quantityDelta: 10,
        reason: 'MANUAL_INCREASE',
      },
      dependsOnCommandIds: [parentCmdId],
    });

    // 3. Enqueue child command 2 (permanently rejected for an unrelated reason)
    await outbox.enqueueCommand(contextA, {
      commandId: 'child-blocked-unrelated',
      installationId: 'install-1',
      idempotencyKey: 'child-blocked-unrelated',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: contextA.outletId,
        listingId: draft.localId,
        quantityDelta: -999, // bad delta
        reason: 'MANUAL_DECREASE',
      },
      dependsOnCommandIds: [parentCmdId],
    });

    // Mark child 2 as REJECTED due to permanent error
    await outbox.markRejected(
      contextA,
      'child-blocked-unrelated',
      'INSUFFICIENT_STOCK',
      'Stock cannot be negative',
    );

    const rejectedBefore = await outbox.getCommand(contextA, 'child-blocked-unrelated');
    expect(rejectedBefore?.state).toBe('REJECTED');

    // 4. Acknowledge parent CATALOG_CREATE with canonical listing ID
    const parentCmd = await outbox.getCommand(contextA, parentCmdId);
    const canonicalId = '55555555-6666-7777-8888-999999999999';
    await reconciler.acknowledgeCreate(contextA, parentCmd!, {
      entityId: canonicalId,
      receiptId: canonicalId,
      resultingVersion: 0,
      serverTimestamp: '2026-08-29T14:00:00.000Z',
    });

    // 5. Assert:
    // - Valid child is remapped to canonical ID and becomes ready for dispatch
    const validChild = await outbox.getCommand(contextA, 'child-valid-1');
    expect(validChild?.state).toBe('PENDING');
    const validPayload = JSON.parse(validChild!.payloadJson);
    expect(validPayload.listingId).toBe(canonicalId);

    // - Rejected child MUST remain REJECTED and not be revived or set to PENDING
    const rejectedAfter = await outbox.getCommand(contextA, 'child-blocked-unrelated');
    expect(rejectedAfter?.state).toBe('REJECTED');
    expect(rejectedAfter?.lastErrorCode).toBe('INSUFFICIENT_STOCK');

    await db.close();
  });

  it('Flow Group W - Duplicate device race: identical converges, divergent retains conflict draft', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const drafts = new DraftLocalRepository(db);
    const reconciler = new DraftSyncReconciler(db);

    // Create offline draft on Device A
    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Conflicting Draft Item',
      kind: 'PRODUCT',
      mrpPaise: 15000,
      sellingPricePaise: 13000,
    });

    const outbox = new CommandOutboxRepository(db);
    const parentCmdId = await drafts.queueForSync(contextA, draft.localId, outbox, 'install-1');

    // Simulate backend returning CATALOG_DUPLICATE (another device created divergent product)
    await reconciler.markConflict(
      contextA,
      parentCmdId,
      'CATALOG_DUPLICATE',
      'Barcode already exists with different product data',
    );

    const conflictDraft = await drafts.getDraft(contextA, draft.localId);
    expect(conflictDraft).not.toBeNull();
    expect(conflictDraft?.status).toBe('CONFLICT');
    expect(conflictDraft?.rejectionCode).toBe('CATALOG_DUPLICATE');
    expect(conflictDraft?.name).toBe('Conflicting Draft Item'); // merchant's draft content preserved

    await db.close();
  });

  it('Flow Group X - Server validation rejection preserves draft metadata and error code', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const drafts = new DraftLocalRepository(db);
    const outbox = new CommandOutboxRepository(db);

    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Restricted Brand Item',
      kind: 'PRODUCT',
      mrpPaise: 5000,
      sellingPricePaise: 4500,
      brand: 'RestrictedBrand',
    });

    const parentCmdId = await drafts.queueForSync(contextA, draft.localId, outbox, 'install-1');

    // Server rejects command with authoritative reason
    await outbox.markRejected(contextA, parentCmdId, 'BRAND_UNAUTHORIZED', 'Merchant is not authorized to list this brand');
    await drafts.markRejected(contextA, parentCmdId, 'BRAND_UNAUTHORIZED', 'Merchant is not authorized to list this brand');

    const rejectedDraft = await drafts.getDraft(contextA, draft.localId);
    expect(rejectedDraft).not.toBeNull();
    expect(rejectedDraft?.status).toBe('REJECTED');
    expect(rejectedDraft?.rejectionCode).toBe('BRAND_UNAUTHORIZED');
    expect(rejectedDraft?.rejectionDetails).toBe('Merchant is not authorized to list this brand');
    expect(rejectedDraft?.name).toBe('Restricted Brand Item');
    expect(rejectedDraft?.brand).toBe('RestrictedBrand');

    await db.close();
  });

  it('Flow Group Z - Media failure after product canonicalization keeps product synced and retries media', async () => {
    let now = Date.parse('2026-08-29T10:00:00.000Z');
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const drafts = new DraftLocalRepository(db, () => now);
    const outbox = new CommandOutboxRepository(db, () => now);
    const media = new PendingMediaRepository(db, () => now);
    const reconciler = new DraftSyncReconciler(db, () => now);

    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Product with Media Failure',
      kind: 'PRODUCT',
      mrpPaise: 5000,
      sellingPricePaise: 4500,
    });

    const parentCmdId = await drafts.queueForSync(contextA, draft.localId, outbox, 'install-1');
    await media.add(contextA, draft.localId, 'file:///photos/p1.jpg', 'image/jpeg', 'media-job-100');

    // Product creation succeeds on server
    const parentCmd = await outbox.getCommand(contextA, parentCmdId);
    const canonicalId = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
    await reconciler.acknowledgeCreate(contextA, parentCmd!, {
      entityId: canonicalId,
      receiptId: canonicalId,
      resultingVersion: 0,
      serverTimestamp: new Date(now).toISOString(),
    });

    // Product is synced
    expect((await drafts.getDraft(contextA, draft.localId))?.status).toBe('SYNCED');

    // Media upload starts and fails (e.g. 503 Service Unavailable)
    const claimedMedia = await media.claimNextReady(contextA);
    expect(claimedMedia?.status).toBe('UPLOADING');

    await media.markFailed(contextA, 'media-job-100', '503 Service Unavailable', 2000);

    // Product remains synced and unaffected
    expect((await drafts.getDraft(contextA, draft.localId))?.status).toBe('SYNCED');

    const failedMedia = await media.get(contextA, 'media-job-100');
    expect(failedMedia?.status).toBe('FAILED');
    expect(failedMedia?.canonicalListingId).toBe(canonicalId);

    // Advance clock past retry delay and claim again
    now += 2500;
    const retryMedia = await media.claimNextReady(contextA);
    expect(retryMedia?.mediaId).toBe('media-job-100');

    await db.close();
  });
});
