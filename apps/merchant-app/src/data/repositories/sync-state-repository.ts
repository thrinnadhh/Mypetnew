import type { SqliteDatabase } from '../database/driver';
import { TABLE_PROJECTION_SYNC_STATE } from '../database/schema';
import type { MerchantPartitionContext } from '../models/partition-context';
import {
  DEFAULT_PROJECTION_TTL_MS,
  type FreshnessOptions,
  type ProjectionFreshness,
  type ProjectionName,
  type SyncDbStatus,
  type SyncStateRecord,
} from '../models/sync-types';

type SyncStateDbRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  projection_name: string;
  last_sync_at: string | null;
  last_attempt_at: string | null;
  status: SyncDbStatus;
  cursor: string | null;
  last_error: string | null;
};

function mapRowToRecord(row: SyncStateDbRow): SyncStateRecord {
  return {
    accountId: row.account_id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    projectionName: row.projection_name,
    lastSyncAt: row.last_sync_at,
    lastAttemptAt: row.last_attempt_at,
    status: row.status,
    cursor: row.cursor,
    lastError: row.last_error,
  };
}

export class SyncStateRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async getSyncState(
    context: MerchantPartitionContext,
    projectionName: ProjectionName,
  ): Promise<SyncStateRecord | null> {
    const row = await this.db.get<SyncStateDbRow>(
      `SELECT * FROM ${TABLE_PROJECTION_SYNC_STATE}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND projection_name = ?;`,
      [context.accountId, context.organizationId, context.outletId, projectionName],
    );
    return row ? mapRowToRecord(row) : null;
  }

  async recordSyncSuccess(
    context: MerchantPartitionContext,
    projectionName: ProjectionName,
    cursor: string | null = null,
    syncedAtIso: string = new Date().toISOString(),
  ): Promise<SyncStateRecord> {
    const status: SyncDbStatus = 'FRESH';
    await this.db.run(
      `INSERT INTO ${TABLE_PROJECTION_SYNC_STATE} (
        account_id, organization_id, outlet_id, projection_name,
        last_sync_at, last_attempt_at, status, cursor, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
        last_sync_at = excluded.last_sync_at,
        last_attempt_at = excluded.last_attempt_at,
        status = excluded.status,
        cursor = excluded.cursor,
        last_error = NULL;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        projectionName,
        syncedAtIso,
        syncedAtIso,
        status,
        cursor,
      ],
    );

    return {
      accountId: context.accountId,
      organizationId: context.organizationId,
      outletId: context.outletId,
      projectionName,
      lastSyncAt: syncedAtIso,
      lastAttemptAt: syncedAtIso,
      status,
      cursor,
      lastError: null,
    };
  }

  async recordSyncFailure(
    context: MerchantPartitionContext,
    projectionName: ProjectionName,
    error: unknown,
    attemptedAtIso: string = new Date().toISOString(),
  ): Promise<SyncStateRecord> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status: SyncDbStatus = 'SYNC_FAILED';

    await this.db.run(
      `INSERT INTO ${TABLE_PROJECTION_SYNC_STATE} (
        account_id, organization_id, outlet_id, projection_name,
        last_sync_at, last_attempt_at, status, cursor, last_error
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?)
      ON CONFLICT(account_id, organization_id, outlet_id, projection_name) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        status = excluded.status,
        last_error = excluded.last_error;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        projectionName,
        attemptedAtIso,
        status,
        errorMessage,
      ],
    );

    const updated = await this.getSyncState(context, projectionName);
    return (
      updated ?? {
        accountId: context.accountId,
        organizationId: context.organizationId,
        outletId: context.outletId,
        projectionName,
        lastSyncAt: null,
        lastAttemptAt: attemptedAtIso,
        status,
        cursor: null,
        lastError: errorMessage,
      }
    );
  }

  async markStale(
    context: MerchantPartitionContext,
    projectionName: ProjectionName,
  ): Promise<void> {
    await this.db.run(
      `UPDATE ${TABLE_PROJECTION_SYNC_STATE}
       SET status = 'STALE'
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND projection_name = ?;`,
      [context.accountId, context.organizationId, context.outletId, projectionName],
    );
  }

  async getFreshness(
    context: MerchantPartitionContext,
    projectionName: ProjectionName,
    options: FreshnessOptions = {},
  ): Promise<ProjectionFreshness> {
    const state = await this.getSyncState(context, projectionName);
    if (!state || state.status === 'NEVER_SYNCED') {
      return 'never-synced';
    }

    if (state.status === 'SYNC_FAILED') {
      return 'sync-failed';
    }

    if (state.status === 'STALE') {
      return 'stale';
    }

    if (!state.lastSyncAt) {
      return 'never-synced';
    }

    const now = options.nowMs ?? Date.now();
    const syncTime = Date.parse(state.lastSyncAt);
    const ttl = options.maxAgeMs ?? DEFAULT_PROJECTION_TTL_MS;

    if (!Number.isFinite(syncTime) || now - syncTime > ttl) {
      return 'stale';
    }

    return 'fresh';
  }
}
