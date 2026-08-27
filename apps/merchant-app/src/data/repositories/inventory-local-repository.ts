import type { InventoryBalance } from '../../inventory/api';
import type { SqliteDatabase, SqliteTransaction } from '../database/driver';
import { TABLE_INVENTORY_BALANCES, TABLE_PROJECTION_SYNC_STATE } from '../database/schema';
import type { InventoryProjectionBatch, LocalInventoryBalance } from '../models/inventory-types';
import type { MerchantPartitionContext } from '../models/partition-context';

type InventoryBalanceDbRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  listing_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  version: number;
  server_updated_at: string;
  local_updated_at: string;
  is_tombstone: number;
  tombstoned_at: string | null;
};

function mapRowToBalance(row: InventoryBalanceDbRow): InventoryBalance {
  return {
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    listingId: row.listing_id,
    onHand: Number(row.on_hand),
    reserved: Number(row.reserved),
    available: Number(row.available),
    version: Number(row.version),
    updatedAt: row.server_updated_at,
  };
}

export type ListInventoryOptions = {
  listingIds?: string[];
  page?: number;
  pageSize?: number;
  includeTombstones?: boolean;
};

export type InventoryListResult = {
  items: InventoryBalance[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export class InventoryLocalRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async upsertBalance(
    context: MerchantPartitionContext,
    balance: InventoryBalance,
    localUpdatedAt: string = new Date().toISOString(),
  ): Promise<LocalInventoryBalance> {
    await this.db.transaction(async (tx) => {
      await this.upsertBalanceInTx(tx, context, balance, localUpdatedAt);
    });

    const stored = await this.getBalance(context, balance.listingId);
    if (!stored) throw new Error('FAILED_TO_PERSIST_INVENTORY_BALANCE');

    return {
      accountId: context.accountId,
      ...stored,
      localUpdatedAt,
      isTombstone: false,
      tombstonedAt: null,
      serverUpdatedAt: balance.updatedAt,
    };
  }

  private async upsertBalanceInTx(
    tx: SqliteTransaction,
    context: MerchantPartitionContext,
    balance: InventoryBalance,
    localUpdatedAt: string,
  ): Promise<void> {
    await tx.run(
      `INSERT INTO ${TABLE_INVENTORY_BALANCES} (
        account_id, organization_id, outlet_id, listing_id,
        on_hand, reserved, available, version,
        server_updated_at, local_updated_at, is_tombstone, tombstoned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      ON CONFLICT(account_id, organization_id, outlet_id, listing_id) DO UPDATE SET
        on_hand = excluded.on_hand,
        reserved = excluded.reserved,
        available = excluded.available,
        version = excluded.version,
        server_updated_at = excluded.server_updated_at,
        local_updated_at = excluded.local_updated_at,
        is_tombstone = 0,
        tombstoned_at = NULL;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        balance.listingId,
        balance.onHand,
        balance.reserved,
        balance.available,
        balance.version,
        balance.updatedAt,
        localUpdatedAt,
      ],
    );
  }

  async applyProjectionBatch(
    context: MerchantPartitionContext,
    batch: InventoryProjectionBatch,
    options: { recordSyncSuccess?: boolean } = { recordSyncSuccess: true },
  ): Promise<{ insertedCount: number; tombstoneCount: number }> {
    const nowIso = new Date().toISOString();

    return this.db.transaction(async (tx) => {
      let insertedCount = 0;
      let tombstoneCount = 0;

      for (const balance of batch.balances) {
        await this.upsertBalanceInTx(tx, context, balance, nowIso);
        insertedCount += 1;
      }

      if (batch.tombstones) {
        for (const tombstone of batch.tombstones) {
          await this.markTombstoneInTx(
            tx,
            context,
            tombstone.listingId,
            tombstone.updatedAt,
            nowIso,
          );
          tombstoneCount += 1;
        }
      }

      if (options.recordSyncSuccess) {
        await tx.run(
          `INSERT INTO ${TABLE_PROJECTION_SYNC_STATE} (
            account_id, organization_id, outlet_id, projection_name,
            last_sync_at, last_attempt_at, status, cursor, last_error
          ) VALUES (?, ?, ?, 'INVENTORY', ?, ?, 'FRESH', ?, NULL)
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

  async getBalance(
    context: MerchantPartitionContext,
    listingId: string,
    includeTombstones = false,
  ): Promise<InventoryBalance | null> {
    const tombstoneClause = includeTombstones ? '' : 'AND is_tombstone = 0';
    const row = await this.db.get<InventoryBalanceDbRow>(
      `SELECT * FROM ${TABLE_INVENTORY_BALANCES}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND listing_id = ? ${tombstoneClause};`,
      [context.accountId, context.organizationId, context.outletId, listingId],
    );
    return row ? mapRowToBalance(row) : null;
  }

  async listBalances(
    context: MerchantPartitionContext,
    options: ListInventoryOptions = {},
  ): Promise<InventoryListResult> {
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

    if (options.listingIds && options.listingIds.length > 0) {
      const placeholders = options.listingIds.map(() => '?').join(', ');
      conditions.push(`listing_id IN (${placeholders})`);
      params.push(...options.listingIds);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${TABLE_INVENTORY_BALANCES} WHERE ${whereClause};`,
      params,
    );
    const totalCount = countRow?.count ?? 0;

    const rows = await this.db.all<InventoryBalanceDbRow>(
      `SELECT * FROM ${TABLE_INVENTORY_BALANCES}
       WHERE ${whereClause}
       ORDER BY listing_id ASC
       LIMIT ? OFFSET ?;`,
      [...params, pageSize, offset],
    );

    const items = rows.map(mapRowToBalance);
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
    listingId: string,
    serverUpdatedAt: string = new Date().toISOString(),
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      return this.markTombstoneInTx(
        tx,
        context,
        listingId,
        serverUpdatedAt,
        new Date().toISOString(),
      );
    });
  }

  private async markTombstoneInTx(
    tx: SqliteTransaction,
    context: MerchantPartitionContext,
    listingId: string,
    serverUpdatedAt: string,
    localUpdatedAt: string,
  ): Promise<boolean> {
    const result = await tx.run(
      `UPDATE ${TABLE_INVENTORY_BALANCES}
       SET is_tombstone = 1,
           tombstoned_at = ?,
           server_updated_at = ?,
           local_updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND listing_id = ?;`,
      [
        serverUpdatedAt,
        serverUpdatedAt,
        localUpdatedAt,
        context.accountId,
        context.organizationId,
        context.outletId,
        listingId,
      ],
    );
    return result.changes > 0;
  }
}
