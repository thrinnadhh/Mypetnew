import type { MerchantListing } from '../../../catalog/api';
import type { InventoryBalance } from '../../../inventory/api';
import { createPartitionContext } from '../../models/partition-context';
import { BarcodeLocalRepository } from '../../repositories/barcode-local-repository';
import { CatalogLocalRepository } from '../../repositories/catalog-local-repository';
import { InventoryLocalRepository } from '../../repositories/inventory-local-repository';
import { SyncStateRepository } from '../../repositories/sync-state-repository';
import { createMerchantDatabase, MerchantDatabase } from '../database';

describe('M5 Partition Isolation Invariants', () => {
  let db: MerchantDatabase;
  let catalogRepo: CatalogLocalRepository;
  let barcodeRepo: BarcodeLocalRepository;
  let inventoryRepo: InventoryLocalRepository;
  let syncStateRepo: SyncStateRepository;

  const partitionA = createPartitionContext('acc-1', 'org-1', 'outlet-1');
  const partitionB = createPartitionContext('acc-2', 'org-2', 'outlet-2');
  const partitionAOutlet2 = createPartitionContext('acc-1', 'org-1', 'outlet-2');

  beforeEach(async () => {
    db = createMerchantDatabase();
    await db.initialize();
    catalogRepo = new CatalogLocalRepository(db);
    barcodeRepo = new BarcodeLocalRepository(db);
    inventoryRepo = new InventoryLocalRepository(db);
    syncStateRepo = new SyncStateRepository(db);
  });

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.close();
    }
  });

  const listingA: MerchantListing = {
    id: 'listing-a',
    organizationId: 'org-1',
    outletId: 'outlet-1',
    name: 'Partition A Product',
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    barcodeType: 'GTIN_13',
    normalizedBarcode: '4006381333931',
    mrpPaise: 50000,
    sellingPricePaise: 45000,
    category: 'Dog Food',
    brand: 'PetBrand',
    description: 'Fresh dog food',
    petType: 'DOG',
    lifeStage: 'ADULT',
    packLabel: '1kg',
    sku: 'SKU-A',
    imageUrls: ['https://example.com/a.jpg'],
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
  };

  const balanceA: InventoryBalance = {
    organizationId: 'org-1',
    outletId: 'outlet-1',
    listingId: 'listing-a',
    onHand: 25,
    reserved: 5,
    available: 20,
    version: 1,
    updatedAt: '2026-08-27T10:00:00.000Z',
  };

  it('Scenario A: Complete isolation between Account/Org/Outlet A and Account/Org/Outlet B', async () => {
    // 1. Persist data into Partition A
    await catalogRepo.upsertListing(partitionA, listingA);
    await inventoryRepo.upsertBalance(partitionA, balanceA);
    await syncStateRepo.recordSyncSuccess(partitionA, 'CATALOG', 'cursor-a-1');

    // 2. Query Partition A — data must exist
    const storedListingA = await catalogRepo.getListingById(partitionA, 'listing-a');
    expect(storedListingA).not.toBeNull();
    expect(storedListingA?.name).toBe('Partition A Product');

    const storedBalanceA = await inventoryRepo.getBalance(partitionA, 'listing-a');
    expect(storedBalanceA).not.toBeNull();
    expect(storedBalanceA?.available).toBe(20);

    const barcodeLookupA = await barcodeRepo.findByBarcode(partitionA, 'GTIN_13', '4006381333931');
    expect(barcodeLookupA.type).toBe('FOUND');

    const syncA = await syncStateRepo.getSyncState(partitionA, 'CATALOG');
    expect(syncA?.cursor).toBe('cursor-a-1');

    // 3. Query Partition B — MUST RETURN EMPTY / NOT FOUND
    const storedListingB = await catalogRepo.getListingById(partitionB, 'listing-a');
    expect(storedListingB).toBeNull();

    const listB = await catalogRepo.listListings(partitionB);
    expect(listB.items).toHaveLength(0);
    expect(listB.totalCount).toBe(0);

    const storedBalanceB = await inventoryRepo.getBalance(partitionB, 'listing-a');
    expect(storedBalanceB).toBeNull();

    const listBalanceB = await inventoryRepo.listBalances(partitionB);
    expect(listBalanceB.items).toHaveLength(0);

    const barcodeLookupB = await barcodeRepo.findByBarcode(partitionB, 'GTIN_13', '4006381333931');
    expect(barcodeLookupB.type).toBe('NOT_FOUND');

    const syncB = await syncStateRepo.getSyncState(partitionB, 'CATALOG');
    expect(syncB).toBeNull();
  });

  it('Scenario B: Outlet-level partition isolation within the same Organization', async () => {
    const listingOutlet2: MerchantListing = {
      ...listingA,
      id: 'listing-outlet2',
      outletId: 'outlet-2',
      name: 'Outlet 2 Specific Product',
      sku: 'SKU-OUTLET-2',
      normalizedBarcode: '8901234567890',
    };

    const balanceOutlet2: InventoryBalance = {
      organizationId: 'org-1',
      outletId: 'outlet-2',
      listingId: 'listing-outlet2',
      onHand: 10,
      reserved: 2,
      available: 8,
      version: 1,
      updatedAt: '2026-08-27T10:00:00.000Z',
    };

    // Outlet 1 gets listingA
    await catalogRepo.upsertListing(partitionA, listingA);
    await inventoryRepo.upsertBalance(partitionA, balanceA);

    // Outlet 2 gets listingOutlet2
    await catalogRepo.upsertListing(partitionAOutlet2, listingOutlet2);
    await inventoryRepo.upsertBalance(partitionAOutlet2, balanceOutlet2);

    // Outlet 1 verification
    const listOutlet1 = await catalogRepo.listListings(partitionA);
    expect(listOutlet1.items).toHaveLength(1);
    expect(listOutlet1.items[0].id).toBe('listing-a');

    const balanceOut1 = await inventoryRepo.getBalance(partitionA, 'listing-a');
    expect(balanceOut1?.available).toBe(20);
    expect(await inventoryRepo.getBalance(partitionA, 'listing-outlet2')).toBeNull();

    // Outlet 2 verification
    const listOutlet2 = await catalogRepo.listListings(partitionAOutlet2);
    expect(listOutlet2.items).toHaveLength(1);
    expect(listOutlet2.items[0].id).toBe('listing-outlet2');

    const balanceOut2 = await inventoryRepo.getBalance(partitionAOutlet2, 'listing-outlet2');
    expect(balanceOut2?.available).toBe(8);
    expect(await inventoryRepo.getBalance(partitionAOutlet2, 'listing-a')).toBeNull();
  });

  it('validates partition context creation rejects empty or whitespace-only keys', () => {
    expect(() => createPartitionContext('', 'org-1', 'outlet-1')).toThrow(/PARTITION_CONTEXT_INVALID/);
    expect(() => createPartitionContext('acc-1', '   ', 'outlet-1')).toThrow(/PARTITION_CONTEXT_INVALID/);
    expect(() => createPartitionContext('acc-1', 'org-1', '')).toThrow(/PARTITION_CONTEXT_INVALID/);
  });
});
