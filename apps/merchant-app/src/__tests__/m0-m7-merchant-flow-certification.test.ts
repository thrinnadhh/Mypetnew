import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeMerchantBarcode } from '../barcode/model';
import { DatabaseBootstrapper } from '../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../data/database/node-driver';
import { createPartitionContext } from '../data/models/partition-context';
import { BarcodeLocalRepository } from '../data/repositories/barcode-local-repository';
import { CatalogLocalRepository } from '../data/repositories/catalog-local-repository';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import { DraftLocalRepository } from '../data/repositories/draft-local-repository';
import { InventoryLocalRepository } from '../data/repositories/inventory-local-repository';
import { PartitionDiscoveryRepository } from '../data/repositories/partition-discovery-repository';
import { PendingMediaRepository } from '../data/repositories/pending-media-repository';
import { SyncStateRepository } from '../data/repositories/sync-state-repository';
import { DraftSyncReconciler } from '../sync/draft-sync-reconciler';

describe('M0–M7 Merchant App Complete Flow Certification', () => {
  const contextAccountA = createPartitionContext('account-merchant-1', 'org-1', 'outlet-1');
  const contextAccountB = createPartitionContext('account-merchant-2', 'org-2', 'outlet-2');

  it('Flow Groups A1, E, F, K - Known barcode lookup offline from local cache with zero network dependency', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);
    const inventoryRepo = new InventoryLocalRepository(db);

    // Verify GTIN normalization preserves leading zeroes
    expect(normalizeMerchantBarcode('GTIN_12', '012345678905')).toBe('012345678905');
    expect(normalizeMerchantBarcode('GTIN_13', '4006381333931')).toBe('4006381333931');
    expect(normalizeMerchantBarcode('GTIN_14', '04006381333931')).toBe('04006381333931');

    const canonicalListingId = '11111111-2222-3333-4444-555555555555';

    // Seed local projection (as if received from online sync)
    await catalogRepo.upsertListing(contextAccountA, {
      id: canonicalListingId,
      organizationId: contextAccountA.organizationId,
      outletId: contextAccountA.outletId,
      barcodeType: 'GTIN_12',
      normalizedBarcode: '012345678905',
      name: 'Pedigree Puppy Food 1kg',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      mrpPaise: 30000,
      sellingPricePaise: 27000,
      category: 'dog-food',
      imageUrls: ['https://cdn.example.com/p1.jpg'],
      status: 'ACTIVE',
      version: 5,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });

    await inventoryRepo.upsertBalance(contextAccountA, {
      listingId: canonicalListingId,
      organizationId: contextAccountA.organizationId,
      outletId: contextAccountA.outletId,
      onHand: 15,
      reserved: 2,
      available: 13,
      version: 3,
      updatedAt: '2026-08-29T00:00:00.000Z',
    });

    // Offline barcode scan
    const scanResult = await barcodeRepo.processScanOffline(contextAccountA, 'GTIN_12', ' 0123 4567 8905 ');
    expect(scanResult.found).toBe(true);
    expect(scanResult.normalizedBarcode).toBe('012345678905');
    expect(scanResult.listing?.id).toBe(canonicalListingId);
    expect(scanResult.listing?.name).toBe('Pedigree Puppy Food 1kg');
    expect(scanResult.listing?.sellingPricePaise).toBe(27000);

    const stock = await inventoryRepo.getBalance(contextAccountA, canonicalListingId);
    expect(stock?.onHand).toBe(15);
    expect(stock?.reserved).toBe(2);
    expect(stock?.available).toBe(13);

    await db.close();
  });

  it('Flow Groups L, M, N, O, P, Q, S, Y - Unknown barcode draft, local ID isolation, persistence across restart, and atomic remap', async () => {
    const dbPath = path.join(os.tmpdir(), `mypet_flow_cert_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);

    try {
      // 1. Session 1: Scan unknown barcode offline, validate GTIN, create draft, attach media, queue outbox
      const db1 = createNodeSqliteDatabase(dbPath);
      await new DatabaseBootstrapper().bootstrap(db1);

      const drafts1 = new DraftLocalRepository(db1);
      const outbox1 = new CommandOutboxRepository(db1);
      const media1 = new PendingMediaRepository(db1);

      // Malformed GTIN should fail local validation
      await expect(
        drafts1.createDraft(contextAccountA, {
          barcodeType: 'GTIN_13',
          barcode: '4006381333932', // bad check digit
          name: 'Invalid Item',
          kind: 'PRODUCT',
          mrpPaise: 1000,
          sellingPricePaise: 900,
        }),
      ).rejects.toMatchObject({ name: 'BARCODE_INVALID' });

      // Create valid Medicine draft
      const draft = await drafts1.createDraft(contextAccountA, {
        barcodeType: 'GTIN_13',
        barcode: '4006381333931',
        name: 'Veterinary Antibiotic 100mg',
        kind: 'MEDICINE',
        mrpPaise: 45000,
        sellingPricePaise: 40000,
        category: 'medicine',
      });

      expect(draft.localId).toMatch(/^local:[0-9a-f-]{36}$/);
      expect(draft.canonicalListingId).toBeNull();
      expect(draft.status).toBe('DRAFT');
      expect(draft.commerceMode).toBe('VIEW_ONLY'); // Medicine is strictly VIEW_ONLY

      // Queue draft for outbox sync
      const parentCmdId = await drafts1.queueForSync(contextAccountA, draft.localId, outbox1, 'device-install-1');
      expect(parentCmdId).toBeDefined();

      // Attach pending local media
      await media1.add(contextAccountA, draft.localId, 'file:///local/cache/med.jpg', 'image/jpeg', 'media-job-1');

      // Enqueue dependent child inventory command
      await outbox1.enqueueCommand(contextAccountA, {
        commandId: 'child-inv-cmd-1',
        installationId: 'device-install-1',
        idempotencyKey: 'child-inv-key-1',
        commandType: 'INVENTORY_ADJUSTMENT',
        payload: {
          outletId: contextAccountA.outletId,
          listingId: draft.localId,
          quantityDelta: 20,
          reason: 'MANUAL_INCREASE',
        },
        dependsOnCommandIds: [parentCmdId],
      });

      await db1.close();

      // 2. Session 2: Simulate process restart / app reopen from disk
      const db2 = createNodeSqliteDatabase(dbPath);
      await new DatabaseBootstrapper().bootstrap(db2);

      const drafts2 = new DraftLocalRepository(db2);
      const outbox2 = new CommandOutboxRepository(db2);
      const media2 = new PendingMediaRepository(db2);
      const barcode2 = new BarcodeLocalRepository(db2);
      const reconciler2 = new DraftSyncReconciler(db2);

      // Verify all state restored cleanly without in-memory dependency
      const restoredDraft = await drafts2.getDraft(contextAccountA, draft.localId);
      expect(restoredDraft).not.toBeNull();
      expect(restoredDraft?.status).toBe('QUEUED');
      expect(restoredDraft?.name).toBe('Veterinary Antibiotic 100mg');

      const restoredMedia = await media2.get(contextAccountA, 'media-job-1');
      expect(restoredMedia).not.toBeNull();
      expect(restoredMedia?.localListingId).toBe(draft.localId);
      expect(restoredMedia?.canonicalListingId).toBeNull();

      const restoredParentCmd = await outbox2.getCommand(contextAccountA, parentCmdId);
      expect(restoredParentCmd).not.toBeNull();
      expect(restoredParentCmd?.commandType).toBe('CATALOG_CREATE');

      // 3. Reconnect & Server ACK simulation: backend canonicalizes listing
      const canonicalBackendId = '99999999-8888-7777-6666-555555555555';
      await reconciler2.acknowledgeCreate(contextAccountA, restoredParentCmd!, {
        entityId: canonicalBackendId,
        receiptId: canonicalBackendId,
        resultingVersion: 0,
        serverTimestamp: '2026-08-29T12:00:00.000Z',
      });

      // 4. Verify atomic reconciliation effects:
      // - Draft status updated to SYNCED with canonicalListingId
      const syncedDraft = await drafts2.getDraft(contextAccountA, draft.localId);
      expect(syncedDraft?.status).toBe('SYNCED');
      expect(syncedDraft?.canonicalListingId).toBe(canonicalBackendId);

      // - Barcode lookup now resolves to canonical ID
      const barcodeLookup = await barcode2.processScanOffline(contextAccountA, 'GTIN_13', '4006381333931');
      expect(barcodeLookup.found).toBe(true);
      expect(barcodeLookup.listing?.id).toBe(canonicalBackendId);

      // - Dependent child command remapped from local ID to canonical ID
      const remappedChild = await outbox2.getCommand(contextAccountA, 'child-inv-cmd-1');
      expect(remappedChild).not.toBeNull();
      const childPayload = JSON.parse(remappedChild!.payloadJson);
      expect(childPayload.listingId).toBe(canonicalBackendId);
      expect(remappedChild!.payloadJson).not.toContain('local:');

      // - Pending media remapped to canonical listing ID and set to QUEUED for upload
      const remappedMedia = await media2.get(contextAccountA, 'media-job-1');
      expect(remappedMedia?.canonicalListingId).toBe(canonicalBackendId);
      expect(remappedMedia?.status).toBe('QUEUED');

      // Claim media for upload
      const claimedMedia = await media2.claimNextReady(contextAccountA);
      expect(claimedMedia?.mediaId).toBe('media-job-1');
      expect(claimedMedia?.canonicalListingId).toBe(canonicalBackendId);

      await db2.close();
    } finally {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    }
  });

  it('Flow Groups A5, I - Account switching provides complete partition isolation', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);

    const drafts = new DraftLocalRepository(db);
    const media = new PendingMediaRepository(db);
    const syncState = new SyncStateRepository(db);
    const partitions = new PartitionDiscoveryRepository(db);

    // 1. Merchant A creates data
    const draftA = await drafts.createDraft(contextAccountA, {
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      name: 'Account A Draft',
      kind: 'PRODUCT',
      mrpPaise: 10000,
      sellingPricePaise: 9000,
    });
    await media.add(contextAccountA, draftA.localId, 'file:///a.jpg', 'image/jpeg', 'media-a');
    await syncState.recordSyncSuccess(contextAccountA, 'CATALOG', 'cursor-account-a');

    // 2. Merchant B logs in (switch account)
    const draftB = await drafts.createDraft(contextAccountB, {
      barcodeType: 'GTIN_13',
      barcode: '5901234123457',
      name: 'Account B Draft',
      kind: 'PRODUCT',
      mrpPaise: 20000,
      sellingPricePaise: 18000,
    });
    await media.add(contextAccountB, draftB.localId, 'file:///b.jpg', 'image/jpeg', 'media-b');
    await syncState.recordSyncSuccess(contextAccountB, 'CATALOG', 'cursor-account-b');

    // Assert Merchant B cannot see Merchant A data
    expect(await drafts.getDraft(contextAccountB, draftA.localId)).toBeNull();
    expect(await drafts.listDrafts(contextAccountB)).toHaveLength(1);
    expect((await drafts.listDrafts(contextAccountB))[0].name).toBe('Account B Draft');
    expect(await media.get(contextAccountB, 'media-a')).toBeNull();
    expect((await syncState.getSyncState(contextAccountB, 'CATALOG'))?.cursor).toBe('cursor-account-b');

    // Assert partition discovery isolates accounts
    const accountAPartitions = await partitions.listKnownPartitionsForAccount('account-merchant-1');
    expect(accountAPartitions).toEqual([contextAccountA]);

    const accountBPartitions = await partitions.listKnownPartitionsForAccount('account-merchant-2');
    expect(accountBPartitions).toEqual([contextAccountB]);

    // 3. Switch back to Merchant A
    expect(await drafts.getDraft(contextAccountA, draftA.localId)).not.toBeNull();
    expect(await media.get(contextAccountA, 'media-a')).not.toBeNull();
    expect((await syncState.getSyncState(contextAccountA, 'CATALOG'))?.cursor).toBe('cursor-account-a');

    await db.close();
  });
});
