import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { BarcodeLocalRepository } from '../barcode-local-repository';
import { CatalogLocalRepository } from '../catalog-local-repository';
import { SyncStateRepository } from '../sync-state-repository';
import { getTombstoneInTx } from '../tombstone-helper';

describe('M5 Catalog Local Repository (Monotonic Tombstones & Projections)', () => {
  const context = createPartitionContext('acc-1', 'org-1', 'out-1');

  it('A) live v3/t3 -> incoming tombstone v2/t2 => live v3 remains visible and barcode FOUND', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);

    const t2 = '2026-08-27T10:00:00.000Z';
    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Live row at v3 / t3
    await catalogRepo.upsertListing(context, {
      id: 'prod-a',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Maxi Adult v3',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'GTIN_13',
      normalizedBarcode: '8901234567890',
      mrpPaise: 50000,
      sellingPricePaise: 45000,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 3,
      createdAt: t3,
      updatedAt: t3,
    });

    // 2. Incoming stale tombstone at v2 / t2 arrives
    const tombstoneResult = await catalogRepo.markTombstone(context, 'prod-a', t2, 2);
    expect(tombstoneResult).toBe('STALE');

    // 3. Invariant: live row remains visible, barcode FOUND
    const liveItem = await catalogRepo.getListingById(context, 'prod-a');
    expect(liveItem).not.toBeNull();
    expect(liveItem?.version).toBe(3);
    expect(liveItem?.name).toBe('Maxi Adult v3');

    const barcodeResult = await barcodeRepo.findByBarcode(context, 'GTIN_13', '8901234567890');
    expect(barcodeResult.type).toBe('FOUND');

    await db.close();
  });

  it('B) live v3/t3 -> incoming tombstone with null version / t2 (t2 < t3) => live row remains visible', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);

    const t2 = '2026-08-27T10:00:00.000Z';
    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Live row at v3 / t3
    await catalogRepo.upsertListing(context, {
      id: 'prod-b',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Item B v3',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'BARCODE-B',
      mrpPaise: 1000,
      sellingPricePaise: 900,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 3,
      createdAt: t3,
      updatedAt: t3,
    });

    // 2. Incoming tombstone with null version at t2 (t2 < t3)
    const tombstoneResult = await catalogRepo.markTombstone(context, 'prod-b', t2, null);
    expect(tombstoneResult).toBe('STALE');

    // 3. Invariant: live row remains visible
    const liveItem = await catalogRepo.getListingById(context, 'prod-b');
    expect(liveItem).not.toBeNull();
    expect(liveItem?.version).toBe(3);

    const barcodeResult = await barcodeRepo.findByBarcode(context, 'INTERNAL', 'BARCODE-B');
    expect(barcodeResult.type).toBe('FOUND');

    await db.close();
  });

  it('C) existing tombstone v3/t3 -> incoming tombstone v2/t3 => tombstone authority remains v3', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);

    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Existing tombstone at v3 / t3
    const res1 = await catalogRepo.markTombstone(context, 'prod-c', t3, 3);
    expect(res1).toBe('APPLIED');

    // 2. Incoming tombstone with lower version v2 at identical timestamp t3
    const res2 = await catalogRepo.markTombstone(context, 'prod-c', t3, 2);
    expect(res2).toBe('STALE');

    // 3. Invariant: tombstone authority in ledger remains v3
    const tombstoneRecord = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'CATALOG', 'prod-c');
    });
    expect(tombstoneRecord?.serverVersion).toBe(3);
    expect(tombstoneRecord?.serverUpdatedAt).toBe(t3);

    await db.close();
  });

  it('D) existing tombstone v3/t3 -> equal tombstone v3/t3 replay => idempotent with no downgrade', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);

    const t3 = '2026-08-27T11:00:00.000Z';

    // 1. Existing tombstone at v3 / t3
    const res1 = await catalogRepo.markTombstone(context, 'prod-d', t3, 3);
    expect(res1).toBe('APPLIED');

    // 2. Equal tombstone replay at v3 / t3
    const res2 = await catalogRepo.markTombstone(context, 'prod-d', t3, 3);
    expect(res2).toBe('IDEMPOTENT');

    // Invariant: authority remains v3 / t3
    const tombstoneRecord = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'CATALOG', 'prod-d');
    });
    expect(tombstoneRecord?.serverVersion).toBe(3);
    expect(tombstoneRecord?.serverUpdatedAt).toBe(t3);

    await db.close();
  });

  it('E) live v1/t1 -> tombstone v2/t2 => delete applies and barcode is NOT_FOUND', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Live row at v1 / t1
    await catalogRepo.upsertListing(context, {
      id: 'prod-e',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Item E v1',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'GTIN_13',
      normalizedBarcode: '4006381333931',
      mrpPaise: 450000,
      sellingPricePaise: 420000,
      category: 'Dog Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 1,
      createdAt: t1,
      updatedAt: t1,
    });

    // 2. Tombstone at v2 / t2
    const res = await catalogRepo.markTombstone(context, 'prod-e', t2, 2);
    expect(res).toBe('APPLIED');

    // 3. Invariant: deleted row is null and barcode is NOT_FOUND
    const item = await catalogRepo.getListingById(context, 'prod-e');
    expect(item).toBeNull();

    const barcode = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(barcode.type).toBe('NOT_FOUND');

    await db.close();
  });

  it('F) unknown entity -> tombstone t2 => durable tombstone created in ledger', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);

    const t2 = '2026-08-27T11:00:00.000Z';

    const res = await catalogRepo.markTombstone(context, 'unknown-entity-f', t2, 1);
    expect(res).toBe('APPLIED');

    const tombstoneRecord = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'CATALOG', 'unknown-entity-f');
    });
    expect(tombstoneRecord).not.toBeNull();
    expect(tombstoneRecord?.serverUpdatedAt).toBe(t2);

    await db.close();
  });

  it('G) tombstone t2 -> stale live t1 => remains deleted and upsert returns null', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';

    // 1. Tombstone at t2
    await catalogRepo.markTombstone(context, 'prod-g', t2, 2);

    // 2. Stale live row at t1 arrives
    const upsertRes = await catalogRepo.upsertListing(context, {
      id: 'prod-g',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Stale Item G',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'BAR-G',
      mrpPaise: 100,
      sellingPricePaise: 90,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 1,
      createdAt: t1,
      updatedAt: t1,
    });
    expect(upsertRes).toBeNull();

    // 3. Invariant: remains deleted
    const item = await catalogRepo.getListingById(context, 'prod-g');
    expect(item).toBeNull();

    const barcode = await barcodeRepo.findByBarcode(context, 'INTERNAL', 'BAR-G');
    expect(barcode.type).toBe('NOT_FOUND');

    await db.close();
  });

  it('H) tombstone t2 -> genuinely newer live t3 => revival succeeds and tombstone cleared', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const barcodeRepo = new BarcodeLocalRepository(db);

    const t2 = '2026-08-27T11:00:00.000Z';
    const t3 = '2026-08-27T12:00:00.000Z';

    // 1. Tombstone at t2, version 2
    await catalogRepo.markTombstone(context, 'prod-h', t2, 2);

    // 2. Genuinely newer live row at t3, version 3
    const upsertRes = await catalogRepo.upsertListing(context, {
      id: 'prod-h',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Revived Item H',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'BAR-H',
      mrpPaise: 100,
      sellingPricePaise: 90,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 3,
      createdAt: t3,
      updatedAt: t3,
    });
    expect(upsertRes).not.toBeNull();
    expect(upsertRes?.name).toBe('Revived Item H');
    expect(upsertRes?.isTombstone).toBe(false);

    // 3. Invariant: visible in query and barcode is FOUND
    const item = await catalogRepo.getListingById(context, 'prod-h');
    expect(item).not.toBeNull();

    const barcode = await barcodeRepo.findByBarcode(context, 'INTERNAL', 'BAR-H');
    expect(barcode.type).toBe('FOUND');

    // Ledger tombstone must be cleared
    const tombstone = await db.transaction(async (tx) => {
      return getTombstoneInTx(tx, context, 'CATALOG', 'prod-h');
    });
    expect(tombstone).toBeNull();

    await db.close();
  });

  it('accurately counts only applied items and tombstones in applyProjectionBatch', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const catalogRepo = new CatalogLocalRepository(db);
    const syncStateRepo = new SyncStateRepository(db);

    const t1 = '2026-08-27T10:00:00.000Z';
    const t2 = '2026-08-27T11:00:00.000Z';
    const t3 = '2026-08-27T12:00:00.000Z';

    // Seed existing live row at v3/t3
    await catalogRepo.upsertListing(context, {
      id: 'existing-v3',
      organizationId: context.organizationId,
      outletId: context.outletId,
      name: 'Existing v3',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      barcodeType: 'INTERNAL',
      normalizedBarcode: 'EX-V3',
      mrpPaise: 100,
      sellingPricePaise: 90,
      category: 'Food',
      imageUrls: [],
      status: 'ACTIVE',
      version: 3,
      createdAt: t3,
      updatedAt: t3,
    });

    // Seed existing tombstone at v3/t3
    await catalogRepo.markTombstone(context, 'tombstone-v3', t3, 3);

    // Batch contains:
    // 1. Fresh new item (should apply -> insertedCount + 1)
    // 2. Stale item against tombstone (should reject -> insertedCount NOT incremented)
    // 3. Valid new tombstone (should apply -> tombstoneCount + 1)
    // 4. Stale tombstone against live v3 row (should reject -> tombstoneCount NOT incremented)
    const batchResult = await catalogRepo.applyProjectionBatch(context, {
      items: [
        {
          id: 'fresh-batch-item',
          organizationId: context.organizationId,
          outletId: context.outletId,
          name: 'Fresh Batch Item',
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          barcodeType: 'INTERNAL',
          normalizedBarcode: 'FRESH-001',
          mrpPaise: 500,
          sellingPricePaise: 450,
          category: 'Food',
          imageUrls: [],
          status: 'ACTIVE',
          version: 1,
          createdAt: t1,
          updatedAt: t1,
        },
        {
          id: 'tombstone-v3', // Stale item against v3 tombstone
          organizationId: context.organizationId,
          outletId: context.outletId,
          name: 'Stale Item',
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          barcodeType: 'INTERNAL',
          normalizedBarcode: 'STALE-001',
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
      tombstones: [
        { id: 'valid-new-tombstone', updatedAt: t2 },
        { id: 'existing-v3', updatedAt: t1 }, // Stale tombstone against live v3 item
      ],
      cursor: 'cursor-v2-batch',
    });

    expect(batchResult.insertedCount).toBe(1);
    expect(batchResult.tombstoneCount).toBe(1);

    const syncState = await syncStateRepo.getSyncState(context, 'CATALOG');
    expect(syncState?.status).toBe('FRESH');
    expect(syncState?.cursor).toBe('cursor-v2-batch');

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
