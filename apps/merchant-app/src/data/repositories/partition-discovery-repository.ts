import type { SqliteDatabase } from '../database/driver';
import { TABLE_CATALOG_DRAFTS, TABLE_CATALOG_ITEMS, TABLE_PROJECTION_SYNC_STATE } from '../database/schema';
import { createPartitionContext, type MerchantPartitionContext } from '../models/partition-context';

type PartitionRow = { organization_id: string; outlet_id: string };

export class PartitionDiscoveryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async listKnownPartitionsForAccount(accountId: string): Promise<MerchantPartitionContext[]> {
    const rows = await this.db.all<PartitionRow>(
      `SELECT DISTINCT organization_id, outlet_id FROM (
         SELECT organization_id, outlet_id FROM ${TABLE_PROJECTION_SYNC_STATE} WHERE account_id = ?
         UNION
         SELECT organization_id, outlet_id FROM ${TABLE_CATALOG_ITEMS} WHERE account_id = ?
         UNION
         SELECT organization_id, outlet_id FROM ${TABLE_CATALOG_DRAFTS} WHERE account_id = ?
       )
       ORDER BY organization_id ASC, outlet_id ASC;`,
      [accountId, accountId, accountId],
    );
    return rows.map((row) => createPartitionContext(accountId, row.organization_id, row.outlet_id));
  }
}
