import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../data/database/driver';
import {
  TABLE_BOOTSTRAP_STAGING_BALANCES,
  TABLE_BOOTSTRAP_STAGING_BARCODES,
  TABLE_BOOTSTRAP_STAGING_ITEMS,
  TABLE_BOOTSTRAP_STAGING_STATE,
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_TOMBSTONES,
} from '../data/database/schema';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import { SyncStateRepository } from '../data/repositories/sync-state-repository';
import type { FetchFunction } from './sync-transport';

export const SUPPORTED_EVENT_SCHEMA_VERSIONS = [1];

export type FeedChange = {
  sequenceNumber: number;
  organizationId: string;
  outletId: string;
  entityType: 'CATALOG_ITEM' | 'CATALOG_BARCODE' | 'INVENTORY_BALANCE';
  entityId: string;
  entityVersion: number;
  isTombstone: boolean;
  payload: string; // JSON string
  schemaVersion: number;
  createdAt: string;
};

export type ChangePageResponse = {
  changes: FeedChange[];
  nextCursor: string | null;
  hasMore: boolean;
  currentHighWaterCursor: string;
  serverTime: string;
};

export type BootstrapItem = {
  id: string;
  organizationId: string;
  outletId: string;
  barcodeType: string;
  normalizedBarcode: string;
  name: string;
  kind: string;
  commerceMode: string;
  mrpPaise: number;
  sellingPricePaise: number;
  category: string;
  brand?: string;
  description?: string;
  petType?: string;
  lifeStage?: string;
  packLabel?: string;
  sku?: string;
  imageUrls: string[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type BootstrapBalance = {
  organizationId: string;
  outletId: string;
  listingId: string;
  onHand: number;
  reserved: number;
  version: number;
  updatedAt: string;
};

export type BootstrapResponse = {
  highWaterCursor: string;
  catalogItems: BootstrapItem[];
  inventoryBalances: BootstrapBalance[];
  nextCursor?: string | null;
  hasMore?: boolean;
  serverTime: string;
};

export class SyncChangeFeedReconciler {
  private readonly syncStateRepo: SyncStateRepository;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly fetchFn: FetchFunction,
  ) {
    this.syncStateRepo = new SyncStateRepository(db);
  }

  async reconcile(context: MerchantPartitionContext): Promise<{ appliedChanges: number; nextCursor: string | null }> {
    const syncState = await this.syncStateRepo.getSyncState(context, 'all');
    const currentCursor = syncState?.cursor ?? null;
    const nowIso = new Date().toISOString();

    try {
      const params = new URLSearchParams({ outletId: context.outletId });
      if (currentCursor) {
        params.set('cursor', currentCursor);
      }
      params.set('limit', '100');

      const response = await this.fetchFn(`/api/v1/merchant/sync/changes?${params.toString()}`);

      if (response.status === 410) {
        // SYNC_CURSOR_EXPIRED -> perform clean rebootstrap
        await this.rebootstrap(context);
        return { appliedChanges: 0, nextCursor: null };
      }

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
        if (errorBody?.code === 'SYNC_CURSOR_EXPIRED') {
          await this.rebootstrap(context);
          return { appliedChanges: 0, nextCursor: null };
        }
        throw new Error(`CHANGE_FEED_FETCH_FAILED: ${errorBody?.message ?? `HTTP ${response.status}`}`);
      }

      const page = (await response.json()) as ChangePageResponse;

      await this.db.transaction(async (tx) => {
        for (const change of page.changes) {
          // 1. Partition validation: must belong to active tenant partition
          if (
            change.organizationId !== context.organizationId ||
            change.outletId !== context.outletId
          ) {
            throw new Error(
              `EVENT_PARTITION_MISMATCH: Change event belongs to foreign tenant org=${change.organizationId} outlet=${change.outletId}`,
            );
          }

          // 2. Event schema compatibility validation
          if (!SUPPORTED_EVENT_SCHEMA_VERSIONS.includes(change.schemaVersion)) {
            throw new Error(
              `UNSUPPORTED_EVENT_SCHEMA: Change event has unsupported schema_version ${change.schemaVersion}`,
            );
          }

          const payload = JSON.parse(change.payload) as Record<string, unknown>;

          if (change.entityType === 'CATALOG_ITEM') {
            if (change.isTombstone) {
              await tx.run(
                `UPDATE ${TABLE_CATALOG_ITEMS}
                 SET is_tombstone = 1, tombstoned_at = ?, local_updated_at = ?
                 WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ?;`,
                [nowIso, nowIso, context.accountId, context.organizationId, context.outletId, change.entityId],
              );
              await tx.run(
                `INSERT INTO ${TABLE_PROJECTION_TOMBSTONES} (
                  account_id, organization_id, outlet_id, projection_name, entity_id,
                  server_updated_at, server_version, deleted_at
                ) VALUES (?, ?, ?, 'catalog_items', ?, ?, ?, ?)
                ON CONFLICT(account_id, organization_id, outlet_id, projection_name, entity_id) DO UPDATE SET
                  server_updated_at = excluded.server_updated_at,
                  server_version = excluded.server_version,
                  deleted_at = excluded.deleted_at;`,
                [
                  context.accountId,
                  context.organizationId,
                  context.outletId,
                  change.entityId,
                  nowIso,
                  change.entityVersion,
                  nowIso,
                ],
              );
            } else {
              // Version check: only update if incoming version >= local version
              const existing = await tx.get<{ version: number }>(
                `SELECT version FROM ${TABLE_CATALOG_ITEMS}
                 WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND id = ?;`,
                [context.accountId, context.organizationId, context.outletId, change.entityId],
              );

              if (!existing || change.entityVersion >= existing.version) {
                await tx.run(
                  `INSERT INTO ${TABLE_CATALOG_ITEMS} (
                    account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
                    barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
                    category, brand, description, pet_type, life_stage, pack_label, sku,
                    image_urls_json, status, version, is_tombstone, server_created_at,
                    server_updated_at, local_updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
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
                    server_updated_at = excluded.server_updated_at,
                    local_updated_at = excluded.local_updated_at;`,
                  [
                    context.accountId,
                    context.organizationId,
                    context.outletId,
                    payload.id,
                    payload.name,
                    payload.kind,
                    payload.commerceMode,
                    payload.barcodeType,
                    payload.normalizedBarcode,
                    payload.mrpPaise,
                    payload.sellingPricePaise,
                    payload.category,
                    payload.brand ?? null,
                    payload.description ?? null,
                    payload.petType ?? null,
                    payload.lifeStage ?? null,
                    payload.packLabel ?? null,
                    payload.sku ?? null,
                    JSON.stringify(payload.imageUrls ?? []),
                    payload.status,
                    payload.version,
                    payload.createdAt,
                    payload.updatedAt,
                    nowIso,
                  ],
                );
              }
            }
          } else if (change.entityType === 'CATALOG_BARCODE') {
            if (change.isTombstone) {
              await tx.run(
                `DELETE FROM ${TABLE_CATALOG_BARCODES}
                 WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND normalized_barcode = ?;`,
                [context.accountId, context.organizationId, context.outletId, payload.normalizedBarcode],
              );
            } else {
              await tx.run(
                `INSERT INTO ${TABLE_CATALOG_BARCODES} (
                  account_id, organization_id, outlet_id, listing_id, barcode_type,
                  normalized_barcode, is_primary, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id, organization_id, outlet_id, normalized_barcode) DO UPDATE SET
                  listing_id = excluded.listing_id,
                  barcode_type = excluded.barcode_type,
                  is_primary = excluded.is_primary,
                  updated_at = excluded.updated_at;`,
                [
                  context.accountId,
                  context.organizationId,
                  context.outletId,
                  payload.listingId,
                  payload.barcodeType,
                  payload.normalizedBarcode,
                  payload.isPrimary ? 1 : 0,
                  payload.updatedAt,
                ],
              );
            }
          } else if (change.entityType === 'INVENTORY_BALANCE') {
            if (change.isTombstone) {
              await tx.run(
                `DELETE FROM ${TABLE_INVENTORY_BALANCES}
                 WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND listing_id = ?;`,
                [context.accountId, context.organizationId, context.outletId, change.entityId],
              );
            } else {
              const existing = await tx.get<{ version: number }>(
                `SELECT version FROM ${TABLE_INVENTORY_BALANCES}
                 WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND listing_id = ?;`,
                [context.accountId, context.organizationId, context.outletId, change.entityId],
              );

              if (!existing || change.entityVersion >= existing.version) {
                await tx.run(
                  `INSERT INTO ${TABLE_INVENTORY_BALANCES} (
                    account_id, organization_id, outlet_id, listing_id, on_hand,
                    reserved, available, version, server_updated_at, local_updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(account_id, organization_id, outlet_id, listing_id) DO UPDATE SET
                    on_hand = excluded.on_hand,
                    reserved = excluded.reserved,
                    available = excluded.available,
                    version = excluded.version,
                    server_updated_at = excluded.server_updated_at,
                    local_updated_at = excluded.local_updated_at;`,
                  [
                    context.accountId,
                    context.organizationId,
                    context.outletId,
                    payload.listingId,
                    payload.onHand,
                    payload.reserved,
                    Number(payload.onHand) - Number(payload.reserved),
                    payload.version,
                    payload.updatedAt,
                    nowIso,
                  ],
                );
              }
            }
          } else {
            throw new Error(`UNSUPPORTED_ENTITY_TYPE: Unrecognized entity type ${(change as { entityType: string }).entityType}`);
          }
        }

        // Update cursor and mark status FRESH
        const nextCursor = page.nextCursor ?? currentCursor;
        await tx.run(
          `INSERT INTO projection_sync_state (
            account_id, organization_id, outlet_id, projection_name,
            last_sync_at, last_attempt_at, status, cursor, last_error
          ) VALUES (?, ?, ?, 'all', ?, ?, 'FRESH', ?, NULL)
          ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
            last_sync_at = excluded.last_sync_at,
            last_attempt_at = excluded.last_attempt_at,
            status = 'FRESH',
            cursor = excluded.cursor,
            last_error = NULL;`,
          [context.accountId, context.organizationId, context.outletId, nowIso, nowIso, nextCursor],
        );
      });

      return {
        appliedChanges: page.changes.length,
        nextCursor: page.nextCursor,
      };
    } catch (reconcileError: unknown) {
      const errorMsg = reconcileError instanceof Error ? reconcileError.message : String(reconcileError);
      await this.db.run(
        `INSERT INTO projection_sync_state (
          account_id, organization_id, outlet_id, projection_name,
          last_sync_at, last_attempt_at, status, cursor, last_error
        ) VALUES (?, ?, ?, 'all', NULL, ?, 'SYNC_FAILED', ?, ?)
        ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          status = 'SYNC_FAILED',
          last_error = excluded.last_error;`,
        [context.accountId, context.organizationId, context.outletId, nowIso, currentCursor, errorMsg],
      );
      throw reconcileError;
    }
  }

  async rebootstrap(context: MerchantPartitionContext): Promise<void> {
    const syncState = await this.syncStateRepo.getSyncState(context, 'all');
    const currentCursor = syncState?.cursor ?? null;
    const nowIso = new Date().toISOString();
    const generationId = Crypto.randomUUID();

    try {
      // Clear any prior staging for this partition
      await this.db.run(
        `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_ITEMS} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );
      await this.db.run(
        `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_BALANCES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );
      await this.db.run(
        `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_BARCODES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );
      await this.db.run(
        `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_STATE} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );

      let pageCursor: string | null = null;
      let highWaterCursor = '';

      // Bounded paging loop: fetch page -> persist to staging -> persist state -> release objects
      do {
        const params = new URLSearchParams({ outletId: context.outletId, limit: '100' });
        if (pageCursor) {
          params.set('cursor', pageCursor);
        }
        const response = await this.fetchFn(`/api/v1/merchant/sync/bootstrap?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`BOOTSTRAP_FETCH_FAILED: HTTP ${response.status}`);
        }

        const data = (await response.json()) as BootstrapResponse;
        if (!highWaterCursor) {
          highWaterCursor = data.highWaterCursor;
        }

        // Persist current page to staging in a transaction, releasing JS memory
        await this.db.transaction(async (tx) => {
          if (data.catalogItems) {
            for (const item of data.catalogItems) {
              await tx.run(
                `INSERT INTO ${TABLE_BOOTSTRAP_STAGING_ITEMS} (
                  generation_id, account_id, organization_id, outlet_id, id, name, kind,
                  commerce_mode, barcode_type, normalized_barcode, mrp_paise,
                  selling_price_paise, category, brand, description, pet_type,
                  life_stage, pack_label, sku, image_urls_json, status, version,
                  server_created_at, server_updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                [
                  generationId,
                  context.accountId,
                  context.organizationId,
                  context.outletId,
                  item.id,
                  item.name,
                  item.kind,
                  item.commerceMode,
                  item.barcodeType,
                  item.normalizedBarcode,
                  item.mrpPaise,
                  item.sellingPricePaise,
                  item.category,
                  item.brand ?? null,
                  item.description ?? null,
                  item.petType ?? null,
                  item.lifeStage ?? null,
                  item.packLabel ?? null,
                  item.sku ?? null,
                  JSON.stringify(item.imageUrls ?? []),
                  item.status,
                  item.version,
                  item.createdAt,
                  item.updatedAt,
                ],
              );

              await tx.run(
                `INSERT INTO ${TABLE_BOOTSTRAP_STAGING_BARCODES} (
                  generation_id, account_id, organization_id, outlet_id, listing_id,
                  barcode_type, normalized_barcode, is_primary, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?);`,
                [
                  generationId,
                  context.accountId,
                  context.organizationId,
                  context.outletId,
                  item.id,
                  item.barcodeType,
                  item.normalizedBarcode,
                  item.updatedAt,
                ],
              );
            }
          }

          if (data.inventoryBalances) {
            for (const bal of data.inventoryBalances) {
              await tx.run(
                `INSERT INTO ${TABLE_BOOTSTRAP_STAGING_BALANCES} (
                  generation_id, account_id, organization_id, outlet_id, listing_id,
                  on_hand, reserved, version, server_updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                [
                  generationId,
                  context.accountId,
                  context.organizationId,
                  context.outletId,
                  bal.listingId,
                  bal.onHand,
                  bal.reserved,
                  bal.version,
                  bal.updatedAt,
                ],
              );
            }
          }

          await tx.run(
            `INSERT INTO ${TABLE_BOOTSTRAP_STAGING_STATE} (
              generation_id, account_id, organization_id, outlet_id,
              high_water_cursor, next_page_cursor, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, organization_id, outlet_id) DO UPDATE SET
              generation_id = excluded.generation_id,
              high_water_cursor = excluded.high_water_cursor,
              next_page_cursor = excluded.next_page_cursor,
              updated_at = excluded.updated_at;`,
            [
              generationId,
              context.accountId,
              context.organizationId,
              context.outletId,
              highWaterCursor,
              data.hasMore ? data.nextCursor : null,
              nowIso,
            ],
          );
        });

        pageCursor = data.hasMore && data.nextCursor ? data.nextCursor : null;
      } while (pageCursor);

      // Final promotion: single atomic transaction promotes staged generation into live tables
      await this.db.transaction(async (tx) => {
        // 1. Delete live projection tables for this partition
        await tx.run(
          `DELETE FROM ${TABLE_CATALOG_BARCODES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [context.accountId, context.organizationId, context.outletId],
        );
        await tx.run(
          `DELETE FROM ${TABLE_CATALOG_ITEMS} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [context.accountId, context.organizationId, context.outletId],
        );
        await tx.run(
          `DELETE FROM ${TABLE_INVENTORY_BALANCES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [context.accountId, context.organizationId, context.outletId],
        );
        await tx.run(
          `DELETE FROM ${TABLE_PROJECTION_TOMBSTONES} WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [context.accountId, context.organizationId, context.outletId],
        );

        // 2. Promote staged catalog items
        await tx.run(
          `INSERT INTO ${TABLE_CATALOG_ITEMS} (
            account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
            barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
            category, brand, description, pet_type, life_stage, pack_label, sku,
            image_urls_json, status, version, is_tombstone, server_created_at,
            server_updated_at, local_updated_at
          )
          SELECT account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
                 barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
                 category, brand, description, pet_type, life_stage, pack_label, sku,
                 image_urls_json, status, version, 0, server_created_at,
                 server_updated_at, ?
          FROM ${TABLE_BOOTSTRAP_STAGING_ITEMS}
          WHERE generation_id = ? AND account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [nowIso, generationId, context.accountId, context.organizationId, context.outletId],
        );

        // 3. Promote staged barcodes
        await tx.run(
          `INSERT INTO ${TABLE_CATALOG_BARCODES} (
            account_id, organization_id, outlet_id, listing_id, barcode_type,
            normalized_barcode, is_primary, updated_at
          )
          SELECT account_id, organization_id, outlet_id, listing_id, barcode_type,
                 normalized_barcode, is_primary, updated_at
          FROM ${TABLE_BOOTSTRAP_STAGING_BARCODES}
          WHERE generation_id = ? AND account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [generationId, context.accountId, context.organizationId, context.outletId],
        );

        // 4. Promote staged inventory balances
        await tx.run(
          `INSERT INTO ${TABLE_INVENTORY_BALANCES} (
            account_id, organization_id, outlet_id, listing_id, on_hand,
            reserved, available, version, server_updated_at, local_updated_at
          )
          SELECT account_id, organization_id, outlet_id, listing_id, on_hand,
                 reserved, (on_hand - reserved), version, server_updated_at, ?
          FROM ${TABLE_BOOTSTRAP_STAGING_BALANCES}
          WHERE generation_id = ? AND account_id = ? AND organization_id = ? AND outlet_id = ?;`,
          [nowIso, generationId, context.accountId, context.organizationId, context.outletId],
        );

        // 5. Clean up staging tables for this generation
        await tx.run(
          `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_ITEMS} WHERE generation_id = ?;`,
          [generationId],
        );
        await tx.run(
          `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_BALANCES} WHERE generation_id = ?;`,
          [generationId],
        );
        await tx.run(
          `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_BARCODES} WHERE generation_id = ?;`,
          [generationId],
        );
        await tx.run(
          `DELETE FROM ${TABLE_BOOTSTRAP_STAGING_STATE} WHERE generation_id = ?;`,
          [generationId],
        );

        // 6. Update projection sync state to FRESH with original high-water cursor H
        await tx.run(
          `INSERT INTO projection_sync_state (
            account_id, organization_id, outlet_id, projection_name,
            last_sync_at, last_attempt_at, status, cursor, last_error
          ) VALUES (?, ?, ?, 'all', ?, ?, 'FRESH', ?, NULL)
          ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
            last_sync_at = excluded.last_sync_at,
            last_attempt_at = excluded.last_attempt_at,
            status = 'FRESH',
            cursor = excluded.cursor,
            last_error = NULL;`,
          [context.accountId, context.organizationId, context.outletId, nowIso, nowIso, highWaterCursor],
        );
      });
    } catch (bootError: unknown) {
      const errorMsg = bootError instanceof Error ? bootError.message : String(bootError);
      await this.db.run(
        `INSERT INTO projection_sync_state (
          account_id, organization_id, outlet_id, projection_name,
          last_sync_at, last_attempt_at, status, cursor, last_error
        ) VALUES (?, ?, ?, 'all', NULL, ?, 'SYNC_FAILED', ?, ?)
        ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          status = 'SYNC_FAILED',
          last_error = excluded.last_error;`,
        [context.accountId, context.organizationId, context.outletId, nowIso, currentCursor, errorMsg],
      );
      throw bootError;
    }
  }
}
