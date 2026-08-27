import fs from 'fs';
import path from 'path';
import type { MerchantListing } from '../../../catalog/api';
import { createMerchantDatabase, MerchantDatabase } from '../../database/database';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { createPartitionContext } from '../../models/partition-context';
import { BarcodeLocalRepository } from '../barcode-local-repository';
import { CatalogLocalRepository } from '../catalog-local-repository';

describe('M5 Barcode Local Repository', () => {
  let db: MerchantDatabase;
  let barcodeRepo: BarcodeLocalRepository;
  let catalogRepo: CatalogLocalRepository;
  const context = createPartitionContext('acc-1', 'org-1', 'outlet-1');

  beforeEach(async () => {
    db = createMerchantDatabase();
    await db.initialize();
    barcodeRepo = new BarcodeLocalRepository(db);
    catalogRepo = new CatalogLocalRepository(db);
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
    name: 'Pet Chew Bone',
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    barcodeType: 'GTIN_13',
    normalizedBarcode: '4006381333931',
    mrpPaise: 25000,
    sellingPricePaise: 22000,
    category: 'Toys',
    status: 'ACTIVE',
    version: 1,
    imageUrls: [],
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
  };

  it('performs offline lookup and returns FOUND for active listing', async () => {
    await catalogRepo.upsertListing(context, sampleListing);

    const result = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(result.type).toBe('FOUND');
    if (result.type === 'FOUND') {
      expect(result.listing.id).toBe('listing-1');
      expect(result.listing.name).toBe('Pet Chew Bone');
    }
  });

  it('normalizes barcode inputs with spaces, hyphens, and preserves leading zeros', async () => {
    const listingWithLeadingZero: MerchantListing = {
      ...sampleListing,
      id: 'listing-zero',
      barcodeType: 'GTIN_13',
      normalizedBarcode: '0123456789012',
    };
    await catalogRepo.upsertListing(context, listingWithLeadingZero);

    // Look up with unformatted raw string containing spaces and dashes
    const result = await barcodeRepo.findByBarcode(context, 'GTIN_13', '012-345 678 9012');
    expect(result.type).toBe('FOUND');
    if (result.type === 'FOUND') {
      expect(result.listing.id).toBe('listing-zero');
      expect(result.listing.normalizedBarcode).toBe('0123456789012');
    }
  });

  it('returns NOT_FOUND for unknown barcodes', async () => {
    const result = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(result.type).toBe('NOT_FOUND');
    if (result.type === 'NOT_FOUND') {
      expect(result.normalizedBarcode).toBe('4006381333931');
    }
  });

  it('fails with validation error on malformed or invalid GTIN checksum', async () => {
    await expect(
      barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333939'), // bad checksum digit
    ).rejects.toThrow('The barcode is not valid.');
  });

  it('excludes tombstoned barcodes and inactive listings by default', async () => {
    await catalogRepo.upsertListing(context, sampleListing);
    await catalogRepo.markTombstone(context, 'listing-1');

    const result = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(result.type).toBe('NOT_FOUND');
  });

  it('handles multiple matching listings gracefully by returning AMBIGUOUS', async () => {
    // Upsert primary listing
    await catalogRepo.upsertListing(context, sampleListing);

    // Upsert second listing mapped to the same barcode
    await catalogRepo.upsertListing(context, {
      ...sampleListing,
      id: 'listing-2',
      name: 'Alternative Chew Bone',
    });

    const result = await barcodeRepo.findByBarcode(context, 'GTIN_13', '4006381333931');
    expect(result.type).toBe('AMBIGUOUS');
    if (result.type === 'AMBIGUOUS') {
      expect(result.matches).toHaveLength(2);
    }
  });

  it('preserves barcode lookup functionality across restart', async () => {
    const tempDbPath = path.join('/tmp', `merchant_barcode_restart_${Date.now()}.db`);

    try {
      const db1 = createMerchantDatabase({ db: createNodeSqliteDatabase(tempDbPath) });
      await db1.initialize();
      const cat1 = new CatalogLocalRepository(db1);
      await cat1.upsertListing(context, sampleListing);
      await db1.close();

      const db2 = createMerchantDatabase({ db: createNodeSqliteDatabase(tempDbPath) });
      await db2.initialize();
      const bar2 = new BarcodeLocalRepository(db2);

      const lookup = await bar2.findByBarcode(context, 'GTIN_13', '4006381333931');
      expect(lookup.type).toBe('FOUND');
      if (lookup.type === 'FOUND') {
        expect(lookup.listing.id).toBe('listing-1');
      }

      await db2.close();
    } finally {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    }
  });
});
