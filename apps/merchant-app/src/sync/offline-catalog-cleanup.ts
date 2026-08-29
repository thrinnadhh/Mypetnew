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
 * Deletes only terminal media bookkeeping and fully-synced draft copies.
 * LOCAL_DRAFT, QUEUED, CONFLICT, REJECTED drafts and retryable/in-flight media are retained.
 * Temp->canonical mappings are retained because dependent commands can still need translation.
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
      `DELETE FROM ${TABLE_LOCAL_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
         AND state = 'SYNCED'
         AND updated_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM ${TABLE_CATALOG_MEDIA_JOBS}
           WHERE ${TABLE_CATALOG_MEDIA_JOBS}.account_id = ${TABLE_LOCAL_CATALOG_DRAFTS}.account_id
             AND ${TABLE_CATALOG_MEDIA_JOBS}.organization_id = ${TABLE_LOCAL_CATALOG_DRAFTS}.organization_id
             AND ${TABLE_CATALOG_MEDIA_JOBS}.outlet_id = ${TABLE_LOCAL_CATALOG_DRAFTS}.outlet_id
             AND ${TABLE_CATALOG_MEDIA_JOBS}.temp_listing_id = ${TABLE_LOCAL_CATALOG_DRAFTS}.temp_listing_id
             AND ${TABLE_CATALOG_MEDIA_JOBS}.state IN ('PENDING', 'UPLOADING', 'RETRYABLE')
         );`,
      [context.accountId, context.organizationId, context.outletId, olderThanIso],
    );

    return {
      terminalMediaJobsDeleted: media.changes,
      syncedDraftsDeleted: drafts.changes,
    };
  });
}
