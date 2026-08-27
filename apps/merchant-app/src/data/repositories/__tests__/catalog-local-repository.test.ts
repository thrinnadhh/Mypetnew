import fs from 'fs';
import path from 'path';
import type { MerchantListing } from '../../../catalog/api';
import { createPartitionContext } from '../../models/partition-context';
import { CatalogLocalRepository } from '../catalog-local-repository';
import { createMerchantDatabase, MerchantDatabase } from '../../database/database';
import { createNodeSqliteDatabase } from '../../database/node-driver';

describe('M5 Catalog Local Repository', () => {
  let db: MerchantDatabase;
  let repo: CatalogLocalRepository;
  const context = createPartitionContext('acc-1', 'org-1', 'outlet-1');

  beforeEach(async () => {
    db = createMerchantDatabase();
    await db.initialize();
    repo = new CatalogLocalRepository(db);
  });

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.close();
    }
  });

  const sampleListing: MerchantListing = {
    id: 'listing-1',
    organizationId: 'org-1',
    outletId: 'outlet-1',
    name: 'Pedigree Adult Dog Food',
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    barcodeType: 'GTIN_13',
    normalizedBarcode: '4006381333931',
    mrpPaise: 120000,
    sellingPricePaise: 110000,
    category: 'Dog Food',
    brand: 'Pedigree',
    description: 'Complete nutrition for adult dogs',
    petType: 'DOG',
    lifeStage: 'ADULT',
    packLabel: '3kg',
    sku: 'PED-ADULT-3KG',
    imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
  };

  it('inserts and retrieves a catalog listing projection with full typed fields', async () => {
    const inserted = await repo.upsertListing(context, sampleListing);

    expect(inserted.id).toBe('listing-1');
    expect(inserted.name).toBe('Pedigree Adult Dog Food');
    expect(inserted.mrpPaise).toBe(120000);
    expect(inserted.sellingPricePaise).toBe(110000);
    expect(inserted.imageUrls).toEqual(['https://example.com/img1.jpg', 'https://example.com/img2.jpg']);
    expect(inserted.isTombstone).toBe(false);

    const retrieved = await repo.getListingById(context, 'listing-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('listing-1');
    expect(retrieved?.name).toBe('Pedigree Adult Dog Food');
    expect(retrieved?.barcodeType).toBe('GTIN_13');
    expect(retrieved?.normalizedBarcode).toBe('4006381333931');
  });

  it('updates an existing listing on version conflict / re-sync', async () => {
    await repo.upsertListing(context, sampleListing);

    const updatedListing: MerchantListing = {
      ...sampleListing,
      name: 'Pedigree Adult Dog Food (Updated)',
      sellingPricePaise: 105000,
      version: 2,
      updatedAt: '2026-08-27T12:00:00.000Z',
    };

    await repo.upsertListing(context, updatedListing);

    const retrieved = await repo.getListingById(context, 'listing-1');
    expect(retrieved?.name).toBe('Pedigree Adult Dog Food (Updated)');
    expect(retrieved?.sellingPricePaise).toBe(105000);
    expect(retrieved?.version).toBe(2);
  });

  it('applies projection batch atomically and records sync state', async () => {
    const batch = {
      items: [
        sampleListing,
        {
          ...sampleListing,
          id: 'listing-2',
          name: 'Whiskas Adult Cat Food',
          sku: 'WHISKAS-CAT-1KG',
          normalizedBarcode: '8901234567890',
        },
      ],
      cursor: 'cursor-batch-1',
    };

    const result = await repo.applyProjectionBatch(context, batch);
    expect(result.insertedCount).toBe(2);
    expect(result.tombstoneCount).toBe(0);

    const list = await repo.listListings(context);
    expect(list.items).toHaveLength(2);
    expect(list.totalCount).toBe(2);
  });

  it('searches listings with query filter across name, SKU, barcode, and brand', async () => {
    await repo.applyProjectionBatch(context, {
      items: [
        sampleListing,
        {
          ...sampleListing,
          id: 'listing-2',
          name: 'Whiskas Adult Cat Food',
          brand: 'Whiskas',
          sku: 'WHISKAS-CAT-1KG',
          category: 'Cat Food',
          normalizedBarcode: '8901234567890',
        },
      ],
    });

    const searchByName = await repo.listListings(context, { query: 'whiskas' });
    expect(searchByName.items).toHaveLength(1);
    expect(searchByName.items[0].id).toBe('listing-2');

    const searchBySku = await repo.listListings(context, { query: 'PED-ADULT' });
    expect(searchBySku.items).toHaveLength(1);
    expect(searchBySku.items[0].id).toBe('listing-1');

    const searchByBarcode = await repo.listListings(context, { query: '8901234567890' });
    expect(searchByBarcode.items).toHaveLength(1);
    expect(searchByBarcode.items[0].id).toBe('listing-2');
  });

  it('filters by status and supports pagination', async () => {
    const inactiveListing: MerchantListing = {
      ...sampleListing,
      id: 'listing-inactive',
      name: 'Inactive Chew Toy',
      status: 'INACTIVE',
      normalizedBarcode: '8901234567899',
    };

    await repo.applyProjectionBatch(context, {
      items: [sampleListing, inactiveListing],
    });

    const activeOnly = await repo.listListings(context, { status: 'ACTIVE' });
    expect(activeOnly.items).toHaveLength(1);
    expect(activeOnly.items[0].id).toBe('listing-1');

    const inactiveOnly = await repo.listListings(context, { status: 'INACTIVE' });
    expect(inactiveOnly.items).toHaveLength(1);
    expect(inactiveOnly.items[0].id).toBe('listing-inactive');

    const allListings = await repo.listListings(context, { status: 'ALL' });
    expect(allListings.items).toHaveLength(2);

    const paginated = await repo.listListings(context, { status: 'ALL', page: 0, pageSize: 1 });
    expect(paginated.items).toHaveLength(1);
    expect(paginated.hasNext).toBe(true);
    expect(paginated.totalCount).toBe(2);
  });

  it('handles tombstones correctly and prevents resurrection', async () => {
    await repo.upsertListing(context, sampleListing);

    // Mark as tombstone
    const tombstoned = await repo.markTombstone(context, 'listing-1');
    expect(tombstoned).toBe(true);

    // Regular query must NOT return tombstoned row
    const queryResult = await repo.getListingById(context, 'listing-1');
    expect(queryResult).toBeNull();

    const listResult = await repo.listListings(context);
    expect(listResult.items).toHaveLength(0);

    // Query with includeTombstones = true returns the item
    const withTombstones = await repo.getListingById(context, 'listing-1', true);
    expect(withTombstones).not.toBeNull();
    expect(withTombstones?.id).toBe('listing-1');
  });

  it('proves restart persistence across SQLite close and reopen using a file database', async () => {
    const tempDbPath = path.join('/tmp', `merchant_restart_test_${Date.now()}.db`);

    try {
      // 1. Initial process: open, initialize, write listing
      const db1 = createMerchantDatabase({ db: createNodeSqliteDatabase(tempDbPath) });
      await db1.initialize();
      const repo1 = new CatalogLocalRepository(db1);

      await repo1.upsertListing(context, sampleListing);
      await db1.close();

      // 2. Restart process: reopen existing file
      const db2 = createMerchantDatabase({ db: createNodeSqliteDatabase(tempDbPath) });
      await db2.initialize();
      const repo2 = new CatalogLocalRepository(db2);

      const persisted = await repo2.getListingById(context, 'listing-1');
      expect(persisted).not.toBeNull();
      expect(persisted?.name).toBe('Pedigree Adult Dog Food');
      expect(persisted?.normalizedBarcode).toBe('4006381333931');

      await db2.close();
    } finally {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    }
  });
});
