import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { BarcodeLocalRepository } from '../barcode-local-repository';
import { CatalogLocalRepository } from '../catalog-local-repository';
import { SyncStateRepository } from '../sync-state-repository';

describe('M5 Catalog Local Repository (Monotonic Tombstones & Projections)', () => {
  const context = createPartitionContext('acc-1', 'org-1', 'out-1');

  it('A) insert v1/t1 -> tombstone at t2 -> apply stale v1/t1 => remains NOT visible and barcode NOT_FOUND', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Insert catalog v1 @ t1
    await catalogRepo.upsertListing(context, {
      id: 'prod-item-1',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Royal Canin Maxi Adult',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'GTIN_13',
      normalizedBarcode: '4006381333931',
      mrpPaise: 450000,
      sellingPricePaise: 420000,
      category: 'Dog Food',
      brand: 'Royal Canin',
      description: 'Premium dog food',
      petType: 'DOG',
      lifeStage: 'ADULT',
      packLabel: '15kg',
      sku: 'RC-MAXI-15KG',
      imageUrls: ['https://example.com/rc.png'],
      status: 'ACTIVE',
      version: 1,
      createdAt: t1,
      updatedAt: t1,
    });

    // Verify visible and barcode found
    const initialItem = await catalogRepo.getListingById(context, 'prod-item-1');
    expect(initialItem).not.toBeNull();
    const barcodeFound = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(barcodeFound.type).toBe('FOUND');

    // 2. Tombstone at t2 (t2 > t1)
    await catalogRepo.markTombstone(context, 'prod-item-1', t2, 1);

    // Verify deleted
    const tombstonedItem = await catalogRepo.getListingById(context, 'prod-item-1');
    expect(tombstonedItem).toBeNull();
    const barcodeAfterDelete = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(barcodeAfterDelete.type).toBe('NOT_FOUND');

    // 3. Stale catalog row @ t1 arrives later
    await catalogRepo.upsertListing(context, {
      id: 'prod-item-1',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Royal Canin Maxi Adult (Stale)',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'GTIN_13',
      normalizedBarcode: '4006381333931',
      mrpPaise: 450000,
      sellingPricePaise: 420000,
      category: 'Dog Food',
      brand: 'Royal Canin',
      description: 'Premium dog food',
      petType: 'DOG',
      lifeStage: 'ADULT',
      packLabel: '15kg',
      sku: 'RC-MAXI-15KG',
      imageUrls: ['https://example.com/rc.png'],
      status: 'ACTIVE',
      version: 1,
      createdAt: t1,
      updatedAt: t1,
    });

    // 4. Invariant: MUST REMAIN DELETED and barcode NOT_FOUND
    const itemAfterStale = await catalogRepo.getListingById(context, 'prod-item-1');
    expect(itemAfterStale).toBeNull();
    const listResult = await catalogRepo.listListings(context);
    expect(listResult.items).toHaveLength(0);
    const barcodeAfterStale = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(barcodeAfterStale.type).toBe('NOT_FOUND');

    await db.close();
  });

  it('B) tombstone unknown catalog ID at t2 -> apply stale entity at t1 => remains NOT visible', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Tombstone arrives for an entity that has never been fetched locally
    await catalogRepo.markTombstone(context, 'unknown-prod-99', t2, 1);

    // 2. Stale entity row with older timestamp t1 arrives later
    await catalogRepo.upsertListing(context, {
      id: 'unknown-prod-99',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Late Arriving Stale Product',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'STALE-99',
      mrpPaise: 1000,
      sellingPricePaise: 900,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 1,
      createdAt: t1,
      updatedAt: t1,
    });

    // 3. Invariant: MUST REMAIN DELETED / NOT VISIBLE
    const item = await catalogRepo.getListingById(context, 'unknown-prod-99');
    expect(item).toBeNull();

    await db.close();
  });

  it('E) newer authoritative row (v3 / t3 > t2) after older tombstone (v2 / t2) => accepted', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';
    const t3 = '2026-08-27T12:00:00.000Z';

    // Insert v1 @ t1
    await catalogRepo.upsertListing(context, {
      id: 'recreated-prod',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Version 1 Item',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'REC-001',
      mrpPaise: 1000,
      sellingPricePaise: 900,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 1,
      createdAt: t1,
      updatedAt: t1,
    });

    // Tombstone @ t2, version 2
    await catalogRepo.markTombstone(context, 'recreated-prod', t2, 2);

    // Genuinely newer server recreation @ t3, version 3
    await catalogRepo.upsertListing(context, {
      id: 'recreated-prod',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Recreated Item (Newer)',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'REC-001',
      mrpPaise: 1200,
      sellingPricePaise: 1100,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 3,
      createdAt: t3,
      updatedAt: t3,
    });

    // Invariant: Newer authoritative row IS accepted
    const item = await catalogRepo.getListingById(context, 'recreated-prod');
    expect(item).not.toBeNull();
    expect(item?.name).toBe('Recreated Item (Newer)');
    expect(item?.version).toBe(3);

    await db.close();
  });

  it('F) applies projection batches atomically including tombstones and cursor updates', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const syncStateRepo = new SyncStateRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    const batchResult = await catalogRepo.applyProjectionBatch(context, {
      items: [
        {
          id: 'batch-prod-1',
          organizationId: context.organizationId,
          outletId: context.outletId,
          name: 'Batch Product 1',
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          barcodeType: 'INTERNAL',
          normalizedBarcode: 'B-001',
          mrpPaise: 500,
          sellingPricePaise: 450,
          category: 'Food',
          imageUrls: [],
          status: 'ACTIVE',
          version: 1,
          createdAt: t1,
          updatedAt: t1,
        },
      ],
      tombstones: [{ id: 'batch-tombstone-1', updatedAt: t2 }],
      cursor: 'cursor-v1-batch',
    });

    expect(batchResult.insertedCount).toBe(1);
    expect(batchResult.tombstoneCount).toBe(1);

    const syncState = await syncStateRepo.getSyncState(context, 'CATALOG');
    expect(syncState?.status).toBe('FRESH');
    expect(syncState?.cursor).toBe('cursor-v1-batch');

    const listing = await catalogRepo.getListingById(context, 'batch-prod-1');
    expect(listing).not.toBeNull();

    await db.close();
  });

  it('filters by status, performs substring search, and supports pagination', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const now = new Date().toISOString();

    for (let i = 1; i <= 5; i++) {
      await catalogRepo.upsertListing(context, {
        id: `p-${i}`,
        organizationId: context.organizationId,
        outletId: context.outletId,
        name: `Pedigree Adult Meat ${i}`,
        kind: 'PRODUCT',
        commerceMode: 'COMMERCE',
        barcodeType: 'INTERNAL',
        normalizedBarcode: `PED-00${i}`,
        mrpPaise: 1000 * i,
        sellingPricePaise: 900 * i,
        category: 'Dog Food',
        brand: 'Pedigree',
        sku: `SKU-PED-${i}`,
        imageUrls: [],
        status: i === 5 ? 'INACTIVE' : 'ACTIVE',
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Active status filter
    const activeResults = await catalogRepo.listListings(context, { status: 'ACTIVE' });
    expect(activeResults.totalCount).toBe(4);

    // Search query
    const searchResults = await catalogRepo.listListings(context, { query: 'SKU-PED-3' });
    expect(searchResults.items).toHaveLength(1);
    expect(searchResults.items[0].id).toBe('p-3');

    // Pagination
    const page1 = await catalogRepo.listListings(context, { page: 0, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasNext).toBe(true);

    await db.close();
  });
});
