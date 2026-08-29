import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import {
  TABLE_CATALOG_MEDIA_JOBS,
  TABLE_LOCAL_CATALOG_DRAFTS,
} from '../data/database/schema';

export type OfflineCatalogCleanupResult = {
  terminalMediaJobsDeleted: number;
  syncedDraftsDeleted: number;
};

/**
 * Deletes only terminal successful/failed media bookkeeping and fully-synced draft copies.
 * LOCAL_DRAFT, QUEUED, CONFLICT, REJECTED drafts and retryable/in-flight media are retained.
 * Temp->canonical mappings are intentionally retained because old dependent commands may still
 * need identity translation during replay/recovery.
 */
export async function cleanupOfflineCatalogState(
  db: SqliteDatabase,
  context: MerchantPartitionContext,
  olderThanIso: string,
): Promise<OfflineCatalogCleanupResult> {
  if (!Number.isFinite(Date.parse(olderThanIso))) throw new Error('CLEANUP_CUTOFF_INVALID');

  return db.transaction(async (tx) => {
    const media = await tx.run(
      `DELETE FROM ${TABLE_CATALOG_MEDIA_JOBS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
         AND state IN ('ACKNOWLEDGED', 'REJECTED')
         AND updated_at < ?;`,
      [context.accountId, context.organizationId, context.outletId, olderThanIso],
    );

    const drafts = await tx.run(
      `DELETE FROM ${TABLE_LOCAL_CATALOG_DRAFTS} d
       WHERE d.account_id = ? AND d.organization_id = ? AND d.outlet_id = ?
         AND d.state = 'SYNCED'
         AND d.updated_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM ${TABLE_CATALOG_MEDIA_JOBS} m
           WHERE m.account_id = d.account_id
             AND m.organization_id = d.organization_id
             AND m.outlet_id = d.outlet_id
             AND m.temp_listing_id = d.temp_listing_id
             AND m.state IN ('PENDING', 'UPLOADING', 'RETRYABLE')
         );`,
      [context.accountId, context.organizationId, context.outletId, olderThanIso],
    );

    return {
      terminalMediaJobsDeleted: media.changes,
      syncedDraftsDeleted: drafts.changes,
    };
  });
}
