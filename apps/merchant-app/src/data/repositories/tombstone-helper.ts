import type { SqliteTransaction } from '../database/driver';
import { TABLE_PROJECTION_TOMBSTONES } from '../database/schema';
import type { MerchantPartitionContext } from '../models/partition-context';
import type { ProjectionName, TombstoneRecord } from '../models/sync-types';

type TombstoneDbRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  projection_name: string;
  entity_id: string;
  server_updated_at: string;
  server_version: number | null;
  deleted_at: string;
};

export type AuthorityComparisonResult = 'GREATER' | 'EQUAL' | 'LESS';

export type TombstoneApplyResult = 'APPLIED' | 'IDEMPOTENT' | 'STALE';

export type ProjectionRowAuthority = {
  version: number | null | undefined;
  serverUpdatedAt: string;
  isTombstone: boolean | number;
  tombstonedAt?: string | null;
};

export function compareServerAuthority(
  incomingVersion: number | null | undefined,
  incomingUpdatedAt: string,
  authoritativeVersion: number | null | undefined,
  authoritativeUpdatedAt: string,
): AuthorityComparisonResult {
  const hasIncomingVersion = typeof incomingVersion === 'number' && !Number.isNaN(incomingVersion);
  const hasAuthVersion = typeof authoritativeVersion === 'number' && !Number.isNaN(authoritativeVersion);

  if (hasIncomingVersion && hasAuthVersion) {
    if (incomingVersion > authoritativeVersion) {
      return 'GREATER';
    }
    if (incomingVersion < authoritativeVersion) {
      return 'LESS';
    }
    // Both versions exist and are equal; compare server timestamps
  }

  const incomingTs = Date.parse(incomingUpdatedAt);
  const authTs = Date.parse(authoritativeUpdatedAt);

  if (!Number.isNaN(incomingTs) && !Number.isNaN(authTs)) {
    if (incomingTs > authTs) return 'GREATER';
    if (incomingTs < authTs) return 'LESS';
    return 'EQUAL';
  }

  if (incomingUpdatedAt > authoritativeUpdatedAt) return 'GREATER';
  if (incomingUpdatedAt < authoritativeUpdatedAt) return 'LESS';
  return 'EQUAL';
}

export function isServerUpdateStrictlyNewer(
  incomingVersion: number | null | undefined,
  incomingUpdatedAt: string,
  authoritativeVersion: number | null | undefined,
  authoritativeUpdatedAt: string,
): boolean {
  return (
    compareServerAuthority(
      incomingVersion,
      incomingUpdatedAt,
      authoritativeVersion,
      authoritativeUpdatedAt,
    ) === 'GREATER'
  );
}

export async function getTombstoneInTx(
  tx: SqliteTransaction,
  context: MerchantPartitionContext,
  projectionName: ProjectionName,
  entityId: string,
): Promise<TombstoneRecord | null> {
  const row = await tx.get<TombstoneDbRow>(
    `SELECT * FROM ${TABLE_PROJECTION_TOMBSTONES}
     WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
       AND projection_name = ? AND entity_id = ?;`,
    [
      context.accountId,
      context.organizationId,
      context.outletId,
      projectionName,
      entityId,
    ],
  );

  if (!row) return null;

  return {
    accountId: row.account_id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    projectionName: row.projection_name,
    entityId: row.entity_id,
    serverUpdatedAt: row.server_updated_at,
    serverVersion: row.server_version,
    deletedAt: row.deleted_at,
  };
}

export async function evaluateTombstoneAuthority(
  tx: SqliteTransaction,
  context: MerchantPartitionContext,
  projectionName: ProjectionName,
  entityId: string,
  incomingServerUpdatedAt: string,
  incomingServerVersion: number | null | undefined,
  existingProjectionRow?: ProjectionRowAuthority | null,
): Promise<TombstoneApplyResult> {
  // 1. Check existing tombstone ledger authority
  const existingTombstone = await getTombstoneInTx(tx, context, projectionName, entityId);
  if (existingTombstone) {
    const cmp = compareServerAuthority(
      incomingServerVersion,
      incomingServerUpdatedAt,
      existingTombstone.serverVersion,
      existingTombstone.serverUpdatedAt,
    );
    if (cmp === 'LESS') {
      return 'STALE';
    }
    if (cmp === 'EQUAL') {
      return 'IDEMPOTENT';
    }
  }

  // 2. Check existing projection row authority
  if (existingProjectionRow) {
    const authVersion = existingProjectionRow.version;
    const authUpdatedAt =
      existingProjectionRow.isTombstone && existingProjectionRow.tombstonedAt
        ? existingProjectionRow.tombstonedAt
        : existingProjectionRow.serverUpdatedAt;

    const cmp = compareServerAuthority(
      incomingServerVersion,
      incomingServerUpdatedAt,
      authVersion,
      authUpdatedAt,
    );

    if (cmp === 'LESS') {
      return 'STALE';
    }

    if (cmp === 'EQUAL') {
      if (existingProjectionRow.isTombstone) {
        return 'IDEMPOTENT';
      }
      return 'STALE';
    }
  }

  return 'APPLIED';
}

export async function recordTombstoneInTx(
  tx: SqliteTransaction,
  context: MerchantPartitionContext,
  projectionName: ProjectionName,
  entityId: string,
  serverUpdatedAt: string,
  serverVersion: number | null = null,
  deletedAt: string = new Date().toISOString(),
): Promise<void> {
  await tx.run(
    `INSERT INTO ${TABLE_PROJECTION_TOMBSTONES} (
      account_id, organization_id, outlet_id, projection_name, entity_id,
      server_updated_at, server_version, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, organization_id, outlet_id, projection_name, entity_id) DO UPDATE SET
      server_updated_at = excluded.server_updated_at,
      server_version = excluded.server_version,
      deleted_at = excluded.deleted_at;`,
    [
      context.accountId,
      context.organizationId,
      context.outletId,
      projectionName,
      entityId,
      serverUpdatedAt,
      serverVersion,
      deletedAt,
    ],
  );
}

export async function clearTombstoneInTx(
  tx: SqliteTransaction,
  context: MerchantPartitionContext,
  projectionName: ProjectionName,
  entityId: string,
): Promise<void> {
  await tx.run(
    `DELETE FROM ${TABLE_PROJECTION_TOMBSTONES}
     WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
       AND projection_name = ? AND entity_id = ?;`,
    [
      context.accountId,
      context.organizationId,
      context.outletId,
      projectionName,
      entityId,
    ],
  );
}
