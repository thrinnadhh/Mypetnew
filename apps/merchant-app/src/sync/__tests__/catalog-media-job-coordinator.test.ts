import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { OfflineCatalogDraftRepository } from '../../data/repositories/offline-catalog-draft-repository';
import type { MerchantListing } from '../../catalog/api';
import { CatalogMediaJobCoordinator, decodeBase64Bytes } from '../catalog-media-job-coordinator';

describe('M7 CatalogMediaJobCoordinator', () => {
  const context = createPartitionContext('acc_media', 'org_media', 'out_media');
  const tempListingId = 'local_00000000-0000-4000-8000-000000000790';
  const canonicalId = '55555555-5555-4555-8555-555555555555';

  async function readyJob() {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new OfflineCatalogDraftRepository(db);
    const outbox = new CommandOutboxRepository(db);
    await drafts.createDraft(context, {
      tempListingId,
      barcodeType: 'INTERNAL',
      barcode: 'MEDIA-M7',
      name: 'Media Product',
      kind: 'PRODUCT',
      mrpPaise: 1000,
      sellingPricePaise: 900,
      category: 'food',
    });
    const create = await outbox.enqueueCommand(context, {
      commandId: 'media-create',
      idempotencyKey: 'media-create-key',
      commandType: 'CATALOG_CREATE',
      payload: {
        tempListingId,
        outletId: context.outletId,
        barcodeType: 'INTERNAL',
        barcode: 'MEDIA-M7',
        name: 'Media Product',
        kind: 'PRODUCT',
        mrpPaise: 1000,
        sellingPricePaise: 900,
        category: 'food',
      },
    });
    await drafts.applyCreateReceipt(context, create, {
      receiptId: canonicalId,
      serverTimestamp: '2026-08-29T00:00:00Z',
      rawResponse: { outcome: 'CREATED', canonicalListingId: canonicalId },
    });
    const job = await drafts.enqueueMediaJob(context, {
      tempListingId,
      filename: 'offline.jpg',
      contentType: 'image/jpeg',
      bytesBase64: '/9j/AA==',
      sizeBytes: 4,
      idempotencyKey: 'offline-media-key',
    });
    return { db, drafts, job };
  }

  const listing: MerchantListing = {
    id: canonicalId,
    organizationId: context.organizationId,
    outletId: context.outletId,
    barcodeType: 'INTERNAL',
    normalizedBarcode: 'MEDIA-M7',
    name: 'Media Product',
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    mrpPaise: 1000,
    sellingPricePaise: 900,
    category: 'food',
    imageUrls: [],
    status: 'ACTIVE',
    version: 0,
    createdAt: '2026-08-29T00:00:00Z',
    updatedAt: '2026-08-29T00:00:00Z',
  };

  it('decodes durable base64 bytes without platform Buffer dependency', () => {
    expect(Array.from(decodeBase64Bytes('/9j/AA=='))).toEqual([255, 216, 255, 0]);
    expect(() => decodeBase64Bytes('not valid')).toThrow('CATALOG_MEDIA_LOCAL_BYTES_INVALID');
  });

  it('uploads mapped media with same idempotency key and marks durable acknowledgement', async () => {
    const { db, drafts, job } = await readyJob();
    const upload = jest.fn(async (_listing, asset, key) => ({
      mediaId: 'media-server-1',
      listingId: canonicalId,
      position: 0,
      publicUrl: 'https://catalog.example/offline.jpg',
      contentType: asset.type,
      sizeBytes: asset.size ?? 0,
      listingVersion: 1,
    }));
    const coordinator = new CatalogMediaJobCoordinator(
      db,
      async () => listing,
      upload,
    );

    const summary = await coordinator.sync(context);
    expect(summary).toEqual({ processed: 1, acknowledged: 1, retryable: 0, rejected: 0 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][2]).toBe('offline-media-key');
    expect(upload.mock.calls[0][0].id).toBe(canonicalId);
    expect((await drafts.getMediaJob(context, job.mediaJobId))?.state).toBe('ACKNOWLEDGED');
    await db.close();
  });

  it('keeps storage and version failures retryable while permission loss is terminal', async () => {
    const retryCase = await readyJob();
    const retryError = new Error('temporary store outage');
    retryError.name = 'CATALOG_MEDIA_STORE_UNAVAILABLE';
    const retryCoordinator = new CatalogMediaJobCoordinator(
      retryCase.db,
      async () => listing,
      async () => { throw retryError; },
    );
    expect(await retryCoordinator.sync(context)).toMatchObject({ retryable: 1, rejected: 0 });
    expect((await retryCase.drafts.getMediaJob(context, retryCase.job.mediaJobId))?.state).toBe('RETRYABLE');
    await retryCase.db.close();

    const rejectCase = await readyJob();
    const permissionError = new Error('revoked');
    permissionError.name = 'PERMISSION_DENIED';
    const rejectCoordinator = new CatalogMediaJobCoordinator(
      rejectCase.db,
      async () => listing,
      async () => { throw permissionError; },
    );
    expect(await rejectCoordinator.sync(context)).toMatchObject({ retryable: 0, rejected: 1 });
    expect((await rejectCase.drafts.getMediaJob(context, rejectCase.job.mediaJobId))?.state).toBe('REJECTED');
    await rejectCase.db.close();
  });
});
