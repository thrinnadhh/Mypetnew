import type { SqliteDatabase } from '../data/database/driver';
import {
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_DRAFTS,
  TABLE_CATALOG_ITEMS,
  TABLE_OFFLINE_COMMANDS,
  TABLE_PENDING_MEDIA,
} from '../data/database/schema';
import {
  computeCanonicalPayloadJson,
  computeRequestFingerprint,
  type OfflineCommandRecord,
  type ServerReceiptData,
} from '../data/models/outbox-types';
import type { MerchantPartitionContext } from '../data/models/partition-context';

type DraftRow = {
  local_id: string;
  barcode_type: string;
  normalized_barcode: string;
  name: string;
  kind: string;
  commerce_mode: string;
  mrp_paise: number;
  selling_price_paise: number;
  category: string;
  brand: string | null;
  description: string | null;
  pet_type: string | null;
  life_stage: string | null;
  pack_label: string | null;
  sku: string | null;
};

type CommandRow = {
  command_id: string;
  command_type: OfflineCommandRecord['commandType'];
  payload_schema_version: number;
  payload_json: string;
};

function canonicalEntityId(receipt: ServerReceiptData): string | null {
  if (receipt.entityId) return receipt.entityId;
  const raw = receipt.rawResponse as Record<string, unknown> | undefined;
  return raw && typeof raw.id === 'string' ? raw.id : null;
}

export class DraftSyncReconciler {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async acknowledgeCreate(
    context: MerchantPartitionContext,
    command: OfflineCommandRecord,
    receipt: ServerReceiptData,
  ): Promise<void> {
    if (command.commandType !== 'CATALOG_CREATE') throw new Error('CATALOG_CREATE_REQUIRED');
    const canonicalId = canonicalEntityId(receipt);
    if (!canonicalId || canonicalId.startsWith('local:')) throw new Error('CANONICAL_LISTING_ID_MISSING');
    const now = new Date(this.clock()).toISOString();
    const receiptJson = JSON.stringify(receipt);

    await this.db.transaction(async (tx) => {
      const draft = await tx.get<DraftRow>(
        `SELECT local_id, barcode_type, normalized_barcode, name, kind, commerce_mode,
                mrp_paise, selling_price_paise, category, brand, description,
                pet_type, life_stage, pack_label, sku
         FROM ${TABLE_CATALOG_DRAFTS}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND create_command_id = ?;`,
        [context.accountId, context.organizationId, context.outletId, command.commandId],
      );
      if (!draft) throw new Error('LOCAL_DRAFT_FOR_COMMAND_NOT_FOUND');

      const version = receipt.resultingVersion ?? 0;
      const serverTimestamp = receipt.serverTimestamp || now;

      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'ACKNOWLEDGED', durable_server_receipt = ?, resulting_version = ?,
             lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL,
             last_error_details = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
        [receiptJson, version, now, context.accountId, context.organizationId, context.outletId, command.commandId],
      );

      await tx.run(
        `UPDATE ${TABLE_CATALOG_DRAFTS}
         SET status = 'SYNCED', canonical_listing_id = ?, rejection_code = NULL,
             rejection_details = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND local_id = ?;`,
        [canonicalId, now, context.accountId, context.organizationId, context.outletId, draft.local_id],
      );

      await tx.run(
        `INSERT INTO ${TABLE_CATALOG_ITEMS} (
          account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
          barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
          category, brand, description, pet_type, life_stage, pack_label, sku,
          image_urls_json, status, version, is_tombstone, tombstoned_at,
          server_created_at, server_updated_at, local_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'ACTIVE', ?, 0, NULL, ?, ?, ?)
        ON CONFLICT(account_id, organization_id, outlet_id, id) DO UPDATE SET
          name = excluded.name, kind = excluded.kind, commerce_mode = excluded.commerce_mode,
          barcode_type = excluded.barcode_type, normalized_barcode = excluded.normalized_barcode,
          mrp_paise = excluded.mrp_paise, selling_price_paise = excluded.selling_price_paise,
          category = excluded.category, brand = excluded.brand, description = excluded.description,
          pet_type = excluded.pet_type, life_stage = excluded.life_stage, pack_label = excluded.pack_label,
          sku = excluded.sku, status = 'ACTIVE', version = excluded.version, is_tombstone = 0,
          tombstoned_at = NULL, server_updated_at = excluded.server_updated_at,
          local_updated_at = excluded.local_updated_at;`,
        [
          context.accountId, context.organizationId, context.outletId, canonicalId,
          draft.name, draft.kind, draft.commerce_mode, draft.barcode_type, draft.normalized_barcode,
          draft.mrp_paise, draft.selling_price_paise, draft.category, draft.brand, draft.description,
          draft.pet_type, draft.life_stage, draft.pack_label, draft.sku, version,
          serverTimestamp, serverTimestamp, now,
        ],
      );

      await tx.run(
        `INSERT INTO ${TABLE_CATALOG_BARCODES} (
          account_id, organization_id, outlet_id, listing_id, barcode_type,
          normalized_barcode, is_primary, is_tombstone, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
        ON CONFLICT(account_id, organization_id, outlet_id, listing_id, barcode_type, normalized_barcode)
        DO UPDATE SET is_primary = 1, is_tombstone = 0, updated_at = excluded.updated_at;`,
        [
          context.accountId, context.organizationId, context.outletId, canonicalId,
          draft.barcode_type, draft.normalized_barcode, now,
        ],
      );

      await tx.run(
        `UPDATE ${TABLE_PENDING_MEDIA}
         SET canonical_listing_id = ?, status = CASE WHEN status = 'UPLOADED' THEN status ELSE 'QUEUED' END,
             next_attempt_at = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND local_listing_id = ?;`,
        [canonicalId, now, context.accountId, context.organizationId, context.outletId, draft.local_id],
      );

      const childRows = await tx.all<CommandRow>(
        `SELECT command_id, command_type, payload_schema_version, payload_json
         FROM ${TABLE_OFFLINE_COMMANDS}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND command_id != ? AND state IN ('PENDING', 'RETRYABLE');`,
        [context.accountId, context.organizationId, context.outletId, command.commandId],
      );

      for (const child of childRows) {
        const payload = JSON.parse(child.payload_json) as Record<string, unknown>;
        if (payload.listingId !== draft.local_id) continue;
        payload.listingId = canonicalId;
        const payloadJson = computeCanonicalPayloadJson(payload);
        const fingerprint = await computeRequestFingerprint(
          child.command_type,
          payload,
          child.payload_schema_version,
        );
        await tx.run(
          `UPDATE ${TABLE_OFFLINE_COMMANDS}
           SET payload_json = ?, request_fingerprint = ?, updated_at = ?
           WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
          [payloadJson, fingerprint, now, context.accountId, context.organizationId, context.outletId, child.command_id],
        );
      }
    });
  }

  async markConflict(
    context: MerchantPartitionContext,
    commandId: string,
    code: string,
    details: string,
  ): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'NEEDS_RECONCILIATION', last_error_code = ?, last_error_details = ?,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
        [code, details, now, context.accountId, context.organizationId, context.outletId, commandId],
      );
      await tx.run(
        `UPDATE ${TABLE_CATALOG_DRAFTS}
         SET status = 'CONFLICT', rejection_code = ?, rejection_details = ?, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND create_command_id = ?;`,
        [code, details, now, context.accountId, context.organizationId, context.outletId, commandId],
      );
    });
  }
}
