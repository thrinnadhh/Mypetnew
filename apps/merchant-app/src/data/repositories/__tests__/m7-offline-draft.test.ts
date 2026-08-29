import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeMerchantBarcode } from '../../../barcode/model';
import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { BarcodeLocalRepository } from '../barcode-local-repository';
import { CatalogLocalRepository } from '../catalog-local-repository';
import { CommandOutboxRepository } from '../command-outbox-repository';
import { DraftLocalRepository } from '../draft-local-repository';
import { PartitionDiscoveryRepository } from '../partition-discovery-repository';
import { PendingMediaRepository } from '../pending-media-repository';
import { DraftSyncReconciler } from '../../../sync/draft-sync-reconciler';

describe('M7 offline barcode draft and identity reconciliation', () => {
  const contextA = createPartitionContext('acc-a', 'org-a', 'out-a');
  const contextB = createPartitionContext('acc-b', 'org-b', 'out-b');
  const contextOtherOutlet = createPartitionContext('acc-a', 'org-a', 'out-b');

  it('resolves a known cached barcode without network and preserves GTIN leading zeroes', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const catalog = new CatalogLocalRepository(db);
    const barcode = new BarcodeLocalRepository(db);

    expect(normalizeMerchantBarcode('GTIN_12', '012345678905')).toBe('012345678905');
    await catalog.upsertListing(contextA, {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: contextA.organizationId,
      outletId: contextA.outletId,
      barcodeType: 'GTIN_12',
      normalizedBarcode: '012345678905',
      name: 'Cached product',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      mrpPaise: 12000,
      sellingPricePaise: 9900,
      category: 'food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 3,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });

    const result = await barcode.processScanOffline(contextA, 'GTIN_12', '0123 4567 8905');
    expect(result.found).toBe(true);
    expect(result.normalizedBarcode).toBe('012345678905');
    expect(result.listing?.name).toBe('Cached product');
    await db.close();
  });

  it('rejects invalid GTIN locally before draft creation', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new DraftLocalRepository(db);

    await expect(drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333932',
      name: 'Bad barcode',
      kind: 'PRODUCT',
      mrpPaise: 1000,
      sellingPricePaise: 900,
    })).rejects.toMatchObject({ name: 'BARCODE_INVALID' });
    expect(await drafts.listDrafts(contextA)).toHaveLength(0);
    await db.close();
  });

  it('creates only an explicit local identity for an unknown barcode and survives restart', async () => {
    const filename = path.join(os.tmpdir(), `mypet_m7_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    try {
      const db1 = createNodeSqliteDatabase(filename);
      await new DatabaseBootstrapper().bootstrap(db1);
      const drafts1 = new DraftLocalRepository(db1);
      const created = await drafts1.createDraft(contextA, {
        barcodeType: 'GTIN_13',
        barcode: '4006381333931',
        name: 'Offline draft',
        kind: 'MEDICINE',
        mrpPaise: 25000,
        sellingPricePaise: 24000,
        category: 'medicine',
      });
      expect(created.localId).toMatch(/^local:/);
      expect(created.canonicalListingId).toBeNull();
      expect(created.commerceMode).toBe('VIEW_ONLY');
      await db1.close();

      const db2 = createNodeSqliteDatabase(filename);
      await new DatabaseBootstrapper().bootstrap(db2);
      const drafts2 = new DraftLocalRepository(db2);
      const restored = await drafts2.getDraft(contextA, created.localId);
      expect(restored?.name).toBe('Offline draft');
      expect(restored?.canonicalListingId).toBeNull();
      await db2.close();
    } finally {
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
    }
  });

  it('isolates drafts and cached partition discovery by account, organization, and outlet', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new DraftLocalRepository(db);
    const created = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Outlet A only',
      kind: 'PRODUCT',
      mrpPaise: 10000,
      sellingPricePaise: 9000,
    });
    await drafts.createDraft(contextB, {
      barcodeType: 'GTIN_13',
      barcode: '5901234123457',
      name: 'Account B only',
      kind: 'PRODUCT',
      mrpPaise: 10000,
      sellingPricePaise: 9000,
    });

    expect(await drafts.getDraft(contextB, created.localId)).toBeNull();
    expect(await drafts.getDraft(contextOtherOutlet, created.localId)).toBeNull();
    expect(await drafts.listDrafts(contextOtherOutlet)).toHaveLength(0);

    const partitions = new PartitionDiscoveryRepository(db);
    expect(await partitions.listKnownPartitionsForAccount('acc-a')).toEqual([contextA]);
    expect(await partitions.listKnownPartitionsForAccount('acc-b')).toEqual([contextB]);
    await db.close();
  });

  it('atomically remaps local identity, dependent commands, cached barcode, and pending media', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new DraftLocalRepository(db);
    const outbox = new CommandOutboxRepository(db);
    const media = new PendingMediaRepository(db);
    const barcode = new BarcodeLocalRepository(db);
    const reconciler = new DraftSyncReconciler(db);

    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Remap me',
      kind: 'PRODUCT',
      mrpPaise: 12000,
      sellingPricePaise: 11000,
      category: 'food',
    });
    const parentId = await drafts.queueForSync(contextA, draft.localId, outbox, 'installation-a');
    await media.add(contextA, draft.localId, 'file:///tmp/photo.jpg', 'image/jpeg', 'media-1');
    await outbox.enqueueCommand(contextA, {
      commandId: 'child-stock',
      installationId: 'installation-a',
      idempotencyKey: 'child-stock',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: contextA.outletId,
        listingId: draft.localId,
        quantityDelta: 5,
        reason: 'MANUAL_INCREASE',
      },
      dependsOnCommandIds: [parentId],
    });

    const parent = await outbox.getCommand(contextA, parentId);
    expect(parent).not.toBeNull();
    const canonicalId = '22222222-2222-4222-8222-222222222222';
    await reconciler.acknowledgeCreate(contextA, parent!, {
      entityId: canonicalId,
      receiptId: canonicalId,
      resultingVersion: 0,
      serverTimestamp: '2026-08-29T10:00:00.000Z',
    });

    const synced = await drafts.getDraft(contextA, draft.localId);
    expect(synced?.status).toBe('SYNCED');
    expect(synced?.canonicalListingId).toBe(canonicalId);

    const barcodeResult = await barcode.processScanOffline(contextA, 'GTIN_13', '4006381333931');
    expect(barcodeResult.found).toBe(true);
    expect(barcodeResult.listing?.id).toBe(canonicalId);

    const child = await outbox.getCommand(contextA, 'child-stock');
    expect(JSON.parse(child!.payloadJson).listingId).toBe(canonicalId);
    expect(child!.payloadJson).not.toContain(draft.localId);

    const pending = await media.get(contextA, 'media-1');
    expect(pending?.canonicalListingId).toBe(canonicalId);
    expect(pending?.status).toBe('QUEUED');
    await db.close();
  });

  it('keeps successful product canonicalization independent from a later media failure', async () => {
    let now = Date.parse('2026-08-29T10:00:00.000Z');
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new DraftLocalRepository(db, () => now);
    const outbox = new CommandOutboxRepository(db, () => now);
    const media = new PendingMediaRepository(db, () => now);
    const reconciler = new DraftSyncReconciler(db, () => now);

    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13', barcode: '4006381333931', name: 'Media retry', kind: 'PRODUCT',
      mrpPaise: 2000, sellingPricePaise: 1800,
    });
    const parentId = await drafts.queueForSync(contextA, draft.localId, outbox);
    await media.add(contextA, draft.localId, 'file:///tmp/image.jpg', 'image/jpeg', 'media-retry');
    const parent = await outbox.getCommand(contextA, parentId);
    await reconciler.acknowledgeCreate(contextA, parent!, {
      entityId: '33333333-3333-4333-8333-333333333333',
      resultingVersion: 0,
      serverTimestamp: new Date(now).toISOString(),
    });

    const claimed = await media.claimNextReady(contextA);
    expect(claimed?.status).toBe('UPLOADING');
    await media.markFailed(contextA, 'media-retry', 'network down', 1000);
    expect((await drafts.getDraft(contextA, draft.localId))?.status).toBe('SYNCED');
    expect((await media.get(contextA, 'media-retry'))?.status).toBe('FAILED');

    now += 1001;
    expect((await media.claimNextReady(contextA))?.mediaId).toBe('media-retry');
    await db.close();
  });

  it('retains rejected/conflicted draft work and blocks dependent commands after parent rejection', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const drafts = new DraftLocalRepository(db);
    const outbox = new CommandOutboxRepository(db);
    const draft = await drafts.createDraft(contextA, {
      barcodeType: 'GTIN_13', barcode: '4006381333931', name: 'Keep my work', kind: 'PRODUCT',
      mrpPaise: 1000, sellingPricePaise: 900,
    });
    const parentId = await drafts.queueForSync(contextA, draft.localId, outbox);
    await outbox.enqueueCommand(contextA, {
      commandId: 'dependent',
      idempotencyKey: 'dependent',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: { outletId: contextA.outletId, listingId: draft.localId, quantityDelta: 1, reason: 'MANUAL_INCREASE' },
      dependsOnCommandIds: [parentId],
    });

    await outbox.markRejected(contextA, parentId, 'LISTING_PRICE_INVALID', 'selling price exceeds policy');
    await drafts.markRejected(contextA, parentId, 'LISTING_PRICE_INVALID', 'selling price exceeds policy');
    const rejected = await drafts.getDraft(contextA, draft.localId);
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.name).toBe('Keep my work');
    expect(rejected?.rejectionCode).toBe('LISTING_PRICE_INVALID');
    expect((await outbox.getCommand(contextA, 'dependent'))?.state).toBe('BLOCKED');

    await drafts.markConflict(contextA, parentId, 'CATALOG_DUPLICATE', 'another device created this barcode');
    const conflict = await drafts.getDraft(contextA, draft.localId);
    expect(conflict?.status).toBe('CONFLICT');
    expect(conflict?.name).toBe('Keep my work');
    await db.close();
  });
});
