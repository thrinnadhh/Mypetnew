import type { SqliteDatabase } from '../data/database/driver';
import { createPartitionContext, type MerchantPartitionContext } from '../data/models/partition-context';
import { TABLE_LOCAL_CATALOG_DRAFTS, TABLE_PROJECTION_SYNC_STATE } from '../data/database/schema';

export async function discoverOfflineCatalogPartitions(
  db: SqliteDatabase,
  accountId: string,
): Promise<MerchantPartitionContext[]> {
  if (!accountId.trim()) return [];
  const rows = await db.all<{ organization_id: string; outlet_id: string }>(
    `SELECT organization_id, outlet_id
       FROM ${TABLE_PROJECTION_SYNC_STATE}
      WHERE account_id = ?
     UNION
     SELECT organization_id, outlet_id
       FROM ${TABLE_LOCAL_CATALOG_DRAFTS}
      WHERE account_id = ?
     ORDER BY organization_id, outlet_id;`,
    [accountId, accountId],
  );
  return rows.map((row) => createPartitionContext(accountId, row.organization_id, row.outlet_id));
}
