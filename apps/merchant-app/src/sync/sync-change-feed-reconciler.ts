import type { SqliteDatabase } from '../data/database/driver';
import {
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_TOMBSTONES,
} from '../data/database/schema';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import { SyncStateRepository } from '../data/repositories/sync-state-repository';
import { merchantApiFetch } from '../auth/session';
import type { FetchFunction } from './sync-transport';

export type ChangeFeedItem = {
  sequenceNumber: number;
  organizationId: string;
  outletId: string;
  entityType: 'CATALOG_ITEM' | 'CATALOG_BARCODE' | 'INVENTORY_BALANCE';
  entityId: string;
  entityVersion: number;
  isTombstone: boolean;
  payload: string;
  schemaVersion: number;
  createdAt: string;
};

export type ChangePageResponse = {
  changes: ChangeFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
  currentHighWaterCursor: string;
  serverTime: string;
};

export type BootstrapResponse = {
  highWaterCursor: string;
  catalogItems: Array<{
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
    brand?: string | null;
    description?: string | null;
    petType?: string | null;
    lifeStage?: string | null;
    packLabel?: string | null;
    sku?: string | null;
    imageUrls: string[];
    status: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  inventoryBalances: Array<{
    organizationId: string;
    outletId: string;
    listingId: string;
    onHand: number;
    reserved: number;
    version: number;
    updatedAt: string;
  }>;
  serverTime: string;
};

export class SyncChangeFeedReconciler {
  private readonly syncStateRepo: SyncStateRepository;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly fetchFn: FetchFunction = merchantApiFetch,
  ) {
    this.syncStateRepo = new SyncStateRepository(db);
  }

  async reconcile(context: MerchantPartitionContext): Promise<{ appliedChanges: number; nextCursor: string | null }> {
    const syncState = await this.syncStateRepo.getSyncState(context, 'all');
    const currentCursor = syncState?.cursor ?? null;

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
    const nowIso = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      for (const change of page.changes) {
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
                  server_updated_at = excluded.server_updated_at,
                  local_updated_at = excluded.local_updated_at;`,
                [
                  context.accountId,
                  context.organizationId,
                  context.outletId,
                  change.entityId,
                  payload.name as string,
                  payload.kind as string,
                  payload.commerceMode as string,
                  payload.barcodeType as string,
                  payload.normalizedBarcode as string,
                  payload.mrpPaise as number,
                  payload.sellingPricePaise as number,
                  payload.category as string,
                  (payload.brand as string) ?? null,
                  (payload.description as string) ?? null,
                  (payload.petType as string) ?? null,
                  (payload.lifeStage as string) ?? null,
                  (payload.packLabel as string) ?? null,
                  (payload.sku as string) ?? null,
                  JSON.stringify(payload.imageUrls ?? []),
                  payload.status as string,
                  change.entityVersion,
                  (payload.createdAt as string) ?? nowIso,
                  (payload.updatedAt as string) ?? nowIso,
                  nowIso,
                ],
              );
            }
          }
        } else if (change.entityType === 'CATALOG_BARCODE') {
          if (change.isTombstone) {
            await tx.run(
              `UPDATE ${TABLE_CATALOG_BARCODES}
               SET is_tombstone = 1, updated_at = ?
               WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
                 AND listing_id = ? AND barcode_type = ? AND normalized_barcode = ?;`,
              [
                nowIso,
                context.accountId,
                context.organizationId,
                context.outletId,
                change.entityId,
                payload.barcodeType as string,
                payload.normalizedBarcode as string,
              ],
            );
          } else {
            await tx.run(
              `INSERT INTO ${TABLE_CATALOG_BARCODES} (
                account_id, organization_id, outlet_id, listing_id, barcode_type,
                normalized_barcode, is_primary, is_tombstone, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
              ON CONFLICT(account_id, organization_id, outlet_id, listing_id, barcode_type, normalized_barcode) DO UPDATE SET
                is_primary = excluded.is_primary,
                is_tombstone = 0,
                updated_at = excluded.updated_at;`,
              [
                context.accountId,
                context.organizationId,
                context.outletId,
                change.entityId,
                payload.barcodeType as string,
                payload.normalizedBarcode as string,
                payload.isPrimary ? 1 : 0,
                nowIso,
              ],
            );
          }
        } else if (change.entityType === 'INVENTORY_BALANCE') {
          const existing = await tx.get<{ version: number }>(
            `SELECT version FROM ${TABLE_INVENTORY_BALANCES}
             WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND listing_id = ?;`,
            [context.accountId, context.organizationId, context.outletId, change.entityId],
          );

          if (!existing || change.entityVersion >= existing.version) {
            await tx.run(
              `INSERT INTO ${TABLE_INVENTORY_BALANCES} (
                account_id, organization_id, outlet_id, listing_id, on_hand, reserved,
                available, version, server_updated_at, local_updated_at, is_tombstone
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
              ON CONFLICT(account_id, organization_id, outlet_id, listing_id) DO UPDATE SET
                on_hand = excluded.on_hand,
                reserved = excluded.reserved,
                available = excluded.available,
                version = excluded.version,
                server_updated_at = excluded.server_updated_at,
                local_updated_at = excluded.local_updated_at,
                is_tombstone = 0;`,
              [
                context.accountId,
                context.organizationId,
                context.outletId,
                change.entityId,
                payload.onHand as number,
                payload.reserved as number,
                (payload.available as number) ?? ((payload.onHand as number) - (payload.reserved as number)),
                change.entityVersion,
                (payload.updatedAt as string) ?? nowIso,
                nowIso,
              ],
            );
          }
        }
      }

      // Update projection sync state cursor
      const nextCursor = page.nextCursor ?? currentCursor;
      await tx.run(
        `INSERT INTO projection_sync_state (
          account_id, organization_id, outlet_id, projection_name,
          last_sync_at, last_attempt_at, status, cursor, last_error
        ) VALUES (?, ?, ?, 'all', ?, ?, 'FRESH', ?, NULL)
        ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
          last_sync_at = excluded.last_sync_at,
          last_attempt_at = excluded.last_attempt_at,
          status = excluded.status,
          cursor = excluded.cursor,
          last_error = NULL;`,
        [context.accountId, context.organizationId, context.outletId, nowIso, nowIso, nextCursor],
      );
    });

    return {
      appliedChanges: page.changes.length,
      nextCursor: page.nextCursor,
    };
  }

  async rebootstrap(context: MerchantPartitionContext): Promise<void> {
    const params = new URLSearchParams({ outletId: context.outletId });
    const response = await this.fetchFn(`/api/v1/merchant/sync/bootstrap?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`BOOTSTRAP_FETCH_FAILED: HTTP ${response.status}`);
    }

    const data = (await response.json()) as BootstrapResponse;
    const nowIso = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      // Clear ONLY projection caches for this partition (PRESERVE outbox tables!)
      await tx.run(
        `DELETE FROM ${TABLE_CATALOG_BARCODES}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );
      await tx.run(
        `DELETE FROM ${TABLE_CATALOG_ITEMS}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );
      await tx.run(
        `DELETE FROM ${TABLE_INVENTORY_BALANCES}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?;`,
        [context.accountId, context.organizationId, context.outletId],
      );

      // Populate catalog items
      for (const item of data.catalogItems) {
        await tx.run(
          `INSERT INTO ${TABLE_CATALOG_ITEMS} (
            account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
            barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
            category, brand, description, pet_type, life_stage, pack_label, sku,
            image_urls_json, status, version, is_tombstone, server_created_at,
            server_updated_at, local_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?);`,
          [
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
            nowIso,
          ],
        );

        await tx.run(
          `INSERT INTO ${TABLE_CATALOG_BARCODES} (
            account_id, organization_id, outlet_id, listing_id, barcode_type,
            normalized_barcode, is_primary, is_tombstone, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?);`,
          [
            context.accountId,
            context.organizationId,
            context.outletId,
            item.id,
            item.barcodeType,
            item.normalizedBarcode,
            nowIso,
          ],
        );
      }

      // Populate inventory balances
      for (const bal of data.inventoryBalances) {
        await tx.run(
          `INSERT INTO ${TABLE_INVENTORY_BALANCES} (
            account_id, organization_id, outlet_id, listing_id, on_hand, reserved,
            available, version, server_updated_at, local_updated_at, is_tombstone
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);`,
          [
            context.accountId,
            context.organizationId,
            context.outletId,
            bal.listingId,
            bal.onHand,
            bal.reserved,
            bal.onHand - bal.reserved,
            bal.version,
            bal.updatedAt,
            nowIso,
          ],
        );
      }

      // Set high-water mark cursor
      await tx.run(
        `INSERT INTO projection_sync_state (
          account_id, organization_id, outlet_id, projection_name,
          last_sync_at, last_attempt_at, status, cursor, last_error
        ) VALUES (?, ?, ?, 'all', ?, ?, 'FRESH', ?, NULL)
        ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
          last_sync_at = excluded.last_sync_at,
          last_attempt_at = excluded.last_attempt_at,
          status = excluded.status,
          cursor = excluded.cursor,
          last_error = NULL;`,
        [context.accountId, context.organizationId, context.outletId, nowIso, nowIso, data.highWaterCursor],
      );
    });
  }
}
