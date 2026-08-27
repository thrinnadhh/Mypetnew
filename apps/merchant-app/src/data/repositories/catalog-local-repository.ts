import type {
  BarcodeType,
  CommerceMode,
  ListingKind,
  ListingStatus,
  MerchantListing,
} from '../../catalog/api';
import type { SqliteDatabase, SqliteTransaction } from '../database/driver';
import {
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_PROJECTION_SYNC_STATE,
} from '../database/schema';
import type { CatalogProjectionBatch, LocalCatalogItem } from '../models/catalog-types';
import type { MerchantPartitionContext } from '../models/partition-context';
import { SyncStateRepository } from './sync-state-repository';
import {
  clearTombstoneInTx,
  compareServerAuthority,
  evaluateTombstoneAuthority,
  getTombstoneInTx,
  recordTombstoneInTx,
  type TombstoneApplyResult,
} from './tombstone-helper';

type CatalogItemDbRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  id: string;
  name: string;
  kind: string;
  commerce_mode: string;
  barcode_type: string;
  normalized_barcode: string;
  mrp_paise: number;
  selling_price_paise: number;
  category: string;
  brand: string | null;
  description: string | null;
  pet_type: string | null;
  life_stage: string | null;
  pack_label: string | null;
  sku: string | null;
  image_urls_json: string;
  status: string;
  version: number;
  is_tombstone: number;
  tombstoned_at: string | null;
  server_created_at: string;
  server_updated_at: string;
  local_updated_at: string;
};

function mapRowToListing(row: CatalogItemDbRow): MerchantListing {
  let imageUrls: string[] = [];
  try {
    imageUrls = JSON.parse(row.image_urls_json);
  } catch {
    imageUrls = [];
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    name: row.name,
    kind: row.kind as ListingKind,
    commerceMode: row.commerce_mode as CommerceMode,
    barcodeType: row.barcode_type as BarcodeType,
    normalizedBarcode: row.normalized_barcode,
    mrpPaise: Number(row.mrp_paise),
    sellingPricePaise: Number(row.selling_price_paise),
    category: row.category,
    brand: row.brand,
    description: row.description,
    petType: row.pet_type,
    lifeStage: row.life_stage,
    packLabel: row.pack_label,
    sku: row.sku,
    imageUrls,
    status: row.status as ListingStatus,
    version: Number(row.version),
    createdAt: row.server_created_at,
    updatedAt: row.server_updated_at,
  };
}

export type ListCatalogOptions = {
  query?: string;
  status?: ListingStatus | 'ALL';
  page?: number;
  pageSize?: number;
  includeTombstones?: boolean;
};

export type CatalogListResult = {
  items: MerchantListing[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export class CatalogLocalRepository {
  private readonly syncStateRepo: SyncStateRepository;

  constructor(private readonly db: SqliteDatabase) {
    this.syncStateRepo = new SyncStateRepository(db);
  }

  async upsertListing(
    context: MerchantPartitionContext,
    listing: MerchantListing,
    localUpdatedAt: string = new Date().toISOString(),
  ): Promise<LocalCatalogItem | null> {
    const applied = await this.db.transaction(async (tx) => {
      return this.upsertListingInTx(tx, context, listing, localUpdatedAt);
    });

    if (!applied) {
      return null;
    }

    const stored = await this.getListingById(context, listing.id, true);
    if (!stored) return null;

    const row = await this.db.get<CatalogItemDbRow>(
      `SELECT is_tombstone, tombstoned_at FROM ${TABLE_CATALOG_ITEMS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ?;`,
      [context.accountId, context.organizationId, context.outletId, listing.id],
    );

    return {
      accountId: context.accountId,
      ...stored,
      brand: stored.brand ?? null,
      description: stored.description ?? null,
      petType: stored.petType ?? null,
      lifeStage: stored.lifeStage ?? null,
      packLabel: stored.packLabel ?? null,
      sku: stored.sku ?? null,
      isTombstone: row ? Boolean(row.is_tombstone) : false,
      tombstonedAt: row ? row.tombstoned_at : null,
      serverCreatedAt: listing.createdAt,
      serverUpdatedAt: listing.updatedAt,
      localUpdatedAt,
    };
  }

  private async upsertListingInTx(
    tx: SqliteTransaction,
    context: MerchantPartitionContext,
    listing: MerchantListing,
    localUpdatedAt: string,
  ): Promise<boolean> {
    // 1. Check tombstone ledger
    const tombstone = await getTombstoneInTx(tx, context, 'CATALOG', listing.id);
    if (tombstone) {
      const cmp = compareServerAuthority(
        listing.version,
        listing.updatedAt,
        tombstone.serverVersion,
        tombstone.serverUpdatedAt,
      );
      if (cmp !== 'GREATER') {
        // Incoming listing is stale or equal authority compared to tombstone; do NOT revive
        return false;
      }
      // Genuinely newer authoritative server row; clear tombstone
      await clearTombstoneInTx(tx, context, 'CATALOG', listing.id);
    }

    // 2. Check existing row authority
    const existing = await tx.get<CatalogItemDbRow>(
      `SELECT version, server_updated_at, is_tombstone, tombstoned_at FROM ${TABLE_CATALOG_ITEMS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ?;`,
      [context.accountId, context.organizationId, context.outletId, listing.id],
    );

    if (existing) {
      if (existing.is_tombstone) {
        const cmp = compareServerAuthority(
          listing.version,
          listing.updatedAt,
          existing.version,
          existing.tombstoned_at ?? existing.server_updated_at,
        );
        if (cmp !== 'GREATER') return false;
      } else {
        const cmp = compareServerAuthority(
          listing.version,
          listing.updatedAt,
          existing.version,
          existing.server_updated_at,
        );
        if (cmp === 'LESS') return false;
      }
    }

    const imageUrlsJson = JSON.stringify(listing.imageUrls ?? []);

    await tx.run(
      `INSERT INTO ${TABLE_CATALOG_ITEMS} (
        account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
        barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
        category, brand, description, pet_type, life_stage, pack_label, sku,
        image_urls_json, status, version, is_tombstone, tombstoned_at,
        server_created_at, server_updated_at, local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
      ON CONFLICT(account_id, organization_id, outlet_id, id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        commerce_mode = excluded.commerce_mode,
        barcode_type = excluded.barcode_type,
        normalized_barcode = excluded.normalized_barcode,
        mrp_paise = excluded.mrp_paise,
        selling_price_paise = excluded.selling_price_paise,
        category = excluded.category,
        brand = excluded.brand,
        description = excluded.description,
        pet_type = excluded.pet_type,
        life_stage = excluded.life_stage,
        pack_label = excluded.pack_label,
        sku = excluded.sku,
        image_urls_json = excluded.image_urls_json,
        status = excluded.status,
        version = excluded.version,
        is_tombstone = 0,
        tombstoned_at = NULL,
        server_created_at = excluded.server_created_at,
        server_updated_at = excluded.server_updated_at,
        local_updated_at = excluded.local_updated_at;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        listing.id,
        listing.name,
        listing.kind,
        listing.commerceMode,
        listing.barcodeType,
        listing.normalizedBarcode,
        listing.mrpPaise,
        listing.sellingPricePaise,
        listing.category,
        listing.brand ?? null,
        listing.description ?? null,
        listing.petType ?? null,
        listing.lifeStage ?? null,
        listing.packLabel ?? null,
        listing.sku ?? null,
        imageUrlsJson,
        listing.status,
        listing.version,
        listing.createdAt,
        listing.updatedAt,
        localUpdatedAt,
      ],
    );

    // Upsert primary barcode mapping in index table
    await tx.run(
      `INSERT INTO ${TABLE_CATALOG_BARCODES} (
        account_id, organization_id, outlet_id, listing_id, barcode_type,
        normalized_barcode, is_primary, is_tombstone, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
      ON CONFLICT(account_id, organization_id, outlet_id, listing_id, barcode_type, normalized_barcode) DO UPDATE SET
        is_primary = 1,
        is_tombstone = 0,
        updated_at = excluded.updated_at;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        listing.id,
        listing.barcodeType,
        listing.normalizedBarcode,
        localUpdatedAt,
      ],
    );

    return true;
  }

  async applyProjectionBatch(
    context: MerchantPartitionContext,
    batch: CatalogProjectionBatch,
    options: { recordSyncSuccess?: boolean } = { recordSyncSuccess: true },
  ): Promise<{ insertedCount: number; tombstoneCount: number }> {
    const nowIso = new Date().toISOString();

    return this.db.transaction(async (tx) => {
      let insertedCount = 0;
      let tombstoneCount = 0;

      for (const item of batch.items) {
        const applied = await this.upsertListingInTx(tx, context, item, nowIso);
        if (applied) {
          insertedCount += 1;
        }
      }

      if (batch.tombstones) {
        for (const tombstone of batch.tombstones) {
          const result = await this.markTombstoneInTx(
            tx,
            context,
            tombstone.id,
            tombstone.updatedAt,
            null,
            nowIso,
          );
          if (result === 'APPLIED') {
            tombstoneCount += 1;
          }
        }
      }

      if (options.recordSyncSuccess) {
        await tx.run(
          `INSERT INTO ${TABLE_PROJECTION_SYNC_STATE} (
            account_id, organization_id, outlet_id, projection_name,
            last_sync_at, last_attempt_at, status, cursor, last_error
          ) VALUES (?, ?, ?, 'CATALOG', ?, ?, 'FRESH', ?, NULL)
          ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
            last_sync_at = excluded.last_sync_at,
            last_attempt_at = excluded.last_attempt_at,
            status = 'FRESH',
            cursor = excluded.cursor,
            last_error = NULL;`,
          [
            context.accountId,
            context.organizationId,
            context.outletId,
            nowIso,
            nowIso,
            batch.cursor ?? null,
          ],
        );
      }

      return { insertedCount, tombstoneCount };
    });
  }

  async getListingById(
    context: MerchantPartitionContext,
    id: string,
    includeTombstones = false,
  ): Promise<MerchantListing | null> {
    const tombstoneClause = includeTombstones ? '' : 'AND is_tombstone = 0';
    const row = await this.db.get<CatalogItemDbRow>(
      `SELECT * FROM ${TABLE_CATALOG_ITEMS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ? ${tombstoneClause};`,
      [context.accountId, context.organizationId, context.outletId, id],
    );
    return row ? mapRowToListing(row) : null;
  }

  async listListings(
    context: MerchantPartitionContext,
    options: ListCatalogOptions = {},
  ): Promise<CatalogListResult> {
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.max(1, options.pageSize ?? 25);
    const offset = page * pageSize;

    const conditions: string[] = [
      'account_id = ?',
      'organization_id = ?',
      'outlet_id = ?',
    ];
    const params: unknown[] = [
      context.accountId,
      context.organizationId,
      context.outletId,
    ];

    if (!options.includeTombstones) {
      conditions.push('is_tombstone = 0');
    }

    if (options.status && options.status !== 'ALL') {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const query = options.query?.trim().toLowerCase();
    if (query) {
      conditions.push(
        "(LOWER(name) LIKE ? OR LOWER(COALESCE(sku, '')) LIKE ? OR LOWER(normalized_barcode) LIKE ? OR LOWER(COALESCE(brand, '')) LIKE ? OR LOWER(category) LIKE ?)",
      );
      const searchPattern = `%${query}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${TABLE_CATALOG_ITEMS} WHERE ${whereClause};`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const rows = await this.db.all<CatalogItemDbRow>(
      `SELECT * FROM ${TABLE_CATALOG_ITEMS}
       WHERE ${whereClause}
       ORDER BY name COLLATE NOCASE ASC, id ASC
       LIMIT ? OFFSET ?;`,
      [...params, pageSize, offset],
    );

    const items = rows.map(mapRowToListing);
    const hasNext = offset + items.length < totalCount;

    return {
      items,
      totalCount,
      page,
      pageSize,
      hasNext,
    };
  }

  async markTombstone(
    context: MerchantPartitionContext,
    id: string,
    serverUpdatedAt: string = new Date().toISOString(),
    serverVersion: number | null = null,
  ): Promise<TombstoneApplyResult> {
    return this.db.transaction(async (tx) => {
      return this.markTombstoneInTx(
        tx,
        context,
        id,
        serverUpdatedAt,
        serverVersion,
        new Date().toISOString(),
      );
    });
  }

  private async markTombstoneInTx(
    tx: SqliteTransaction,
    context: MerchantPartitionContext,
    id: string,
    serverUpdatedAt: string,
    serverVersion: number | null,
    localUpdatedAt: string,
  ): Promise<TombstoneApplyResult> {
    // 1. Fetch existing live/tombstoned catalog item row
    const existing = await tx.get<CatalogItemDbRow>(
      `SELECT version, server_updated_at, is_tombstone, tombstoned_at FROM ${TABLE_CATALOG_ITEMS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ?;`,
      [context.accountId, context.organizationId, context.outletId, id],
    );

    // 2. Evaluate authority against both tombstone ledger and existing projection row
    const authorityResult = await evaluateTombstoneAuthority(
      tx,
      context,
      'CATALOG',
      id,
      serverUpdatedAt,
      serverVersion,
      existing
        ? {
            version: existing.version,
            serverUpdatedAt: existing.server_updated_at,
            isTombstone: Boolean(existing.is_tombstone),
            tombstonedAt: existing.tombstoned_at,
          }
        : null,
    );

    if (authorityResult !== 'APPLIED') {
      return authorityResult;
    }

    // 3. Record into durable tombstone ledger
    await recordTombstoneInTx(
      tx,
      context,
      'CATALOG',
      id,
      serverUpdatedAt,
      serverVersion,
      localUpdatedAt,
    );

    // 4. Update catalog items projection table
    await tx.run(
      `UPDATE ${TABLE_CATALOG_ITEMS}
       SET is_tombstone = 1,
           tombstoned_at = ?,
           server_updated_at = ?,
           local_updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ?;`,
      [
        serverUpdatedAt,
        serverUpdatedAt,
        localUpdatedAt,
        context.accountId,
        context.organizationId,
        context.outletId,
        id,
      ],
    );

    // 5. Update catalog barcodes projection table
    await tx.run(
      `UPDATE ${TABLE_CATALOG_BARCODES}
       SET is_tombstone = 1,
           updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND listing_id = ?;`,
      [
        localUpdatedAt,
        context.accountId,
        context.organizationId,
        context.outletId,
        id,
      ],
    );

    return 'APPLIED';
  }
}
