import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../database/driver';
import {
  TABLE_CATALOG_IDENTITY_MAPPINGS,
  TABLE_CATALOG_MEDIA_JOBS,
  TABLE_LOCAL_CATALOG_DRAFTS,
} from '../database/schema';
import type { MerchantPartitionContext } from '../models/partition-context';
import {
  computeCanonicalPayloadJson,
  type CatalogCreatePayload,
  type OfflineCommandRecord,
  type ServerReceiptData,
} from '../models/outbox-types';

export type LocalCatalogDraftState = 'LOCAL_DRAFT' | 'QUEUED' | 'SYNCED' | 'CONFLICT' | 'REJECTED';
export type CatalogMediaJobState = 'PENDING' | 'UPLOADING' | 'RETRYABLE' | 'ACKNOWLEDGED' | 'REJECTED';

export type LocalCatalogDraft = CatalogCreatePayload & {
  createCommandId: string | null;
  canonicalListingId: string | null;
  state: LocalCatalogDraftState;
  conflictJson: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogIdentityMapping = {
  tempListingId: string;
  canonicalListingId: string;
  outcome: 'CREATED' | 'EXISTING_LISTING';
  mappedAt: string;
};

export type CatalogMediaJob = {
  mediaJobId: string;
  tempListingId: string;
  canonicalListingId: string | null;
  filename: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytesBase64: string;
  sizeBytes: number;
  idempotencyKey: string;
  state: CatalogMediaJobState;
  attemptCount: number;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type DraftRow = {
  temp_listing_id: string;
  create_command_id: string | null;
  canonical_listing_id: string | null;
  barcode_type: CatalogCreatePayload['barcodeType'];
  barcode: string;
  name: string;
  kind: CatalogCreatePayload['kind'];
  mrp_paise: number;
  selling_price_paise: number;
  category: string;
  brand: string | null;
  description: string | null;
  pet_type: string | null;
  life_stage: string | null;
  pack_label: string | null;
  sku: string | null;
  state: LocalCatalogDraftState;
  conflict_json: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

type MappingRow = {
  temp_listing_id: string;
  canonical_listing_id: string;
  outcome: CatalogIdentityMapping['outcome'];
  mapped_at: string;
};

type MediaRow = {
  media_job_id: string;
  temp_listing_id: string;
  canonical_listing_id: string | null;
  filename: string;
  content_type: CatalogMediaJob['contentType'];
  bytes_base64: string;
  size_bytes: number;
  idempotency_key: string;
  state: CatalogMediaJobState;
  attempt_count: number;
  lease_expires_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

function mapDraft(row: DraftRow, outletId: string): LocalCatalogDraft {
  return {
    tempListingId: row.temp_listing_id,
    outletId,
    barcodeType: row.barcode_type,
    barcode: row.barcode,
    name: row.name,
    kind: row.kind,
    mrpPaise: row.mrp_paise,
    sellingPricePaise: row.selling_price_paise,
    category: row.category,
    brand: row.brand,
    description: row.description,
    petType: row.pet_type,
    lifeStage: row.life_stage,
    packLabel: row.pack_label,
    sku: row.sku,
    createCommandId: row.create_command_id,
    canonicalListingId: row.canonical_listing_id,
    state: row.state,
    conflictJson: row.conflict_json,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row: MediaRow): CatalogMediaJob {
  return {
    mediaJobId: row.media_job_id,
    tempListingId: row.temp_listing_id,
    canonicalListingId: row.canonical_listing_id,
    filename: row.filename,
    contentType: row.content_type,
    bytesBase64: row.bytes_base64,
    sizeBytes: row.size_bytes,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    attemptCount: row.attempt_count,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OfflineCatalogDraftRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  async createDraft(
    context: MerchantPartitionContext,
    input: Omit<CatalogCreatePayload, 'tempListingId' | 'outletId'> & { tempListingId?: string },
  ): Promise<LocalCatalogDraft> {
    const tempListingId = input.tempListingId ?? `local_${Crypto.randomUUID()}`;
    if (!/^local_[0-9a-f-]{36}$/i.test(tempListingId)) throw new Error('LOCAL_DRAFT_ID_INVALID');
    const existing = await this.getDraft(context, tempListingId);
    if (existing) return existing;
    const now = this.nowIso();
    await this.db.run(
      `INSERT INTO ${TABLE_LOCAL_CATALOG_DRAFTS} (
        account_id, organization_id, outlet_id, temp_listing_id,
        barcode_type, barcode, name, kind, mrp_paise, selling_price_paise,
        category, brand, description, pet_type, life_stage, pack_label, sku,
        state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOCAL_DRAFT', ?, ?);`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        tempListingId,
        input.barcodeType,
        input.barcode,
        input.name,
        input.kind,
        input.mrpPaise,
        input.sellingPricePaise,
        input.category,
        input.brand ?? null,
        input.description ?? null,
        input.petType ?? null,
        input.lifeStage ?? null,
        input.packLabel ?? null,
        input.sku ?? null,
        now,
        now,
      ],
    );
    const created = await this.getDraft(context, tempListingId);
    if (!created) throw new Error('LOCAL_DRAFT_PERSISTENCE_ERROR');
    return created;
  }

  async getDraft(context: MerchantPartitionContext, tempListingId: string): Promise<LocalCatalogDraft | null> {
    const row = await this.db.get<DraftRow>(
      `SELECT * FROM ${TABLE_LOCAL_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, tempListingId],
    );
    return row ? mapDraft(row, context.outletId) : null;
  }

  async listDrafts(context: MerchantPartitionContext): Promise<LocalCatalogDraft[]> {
    const rows = await this.db.all<DraftRow>(
      `SELECT * FROM ${TABLE_LOCAL_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
       ORDER BY created_at ASC;`,
      [context.accountId, context.organizationId, context.outletId],
    );
    return rows.map((row) => mapDraft(row, context.outletId));
  }

  async attachCreateCommand(
    context: MerchantPartitionContext,
    tempListingId: string,
    commandId: string,
  ): Promise<void> {
    await this.db.run(
      `UPDATE ${TABLE_LOCAL_CATALOG_DRAFTS}
       SET create_command_id = ?, state = 'QUEUED', last_error_code = NULL, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?;`,
      [commandId, this.nowIso(), context.accountId, context.organizationId, context.outletId, tempListingId],
    );
  }

  async applyCreateReceipt(
    context: MerchantPartitionContext,
    command: OfflineCommandRecord,
    receipt: ServerReceiptData,
  ): Promise<CatalogIdentityMapping | null> {
    if (command.commandType !== 'CATALOG_CREATE') return null;
    const payload = JSON.parse(command.payloadJson) as CatalogCreatePayload;
    const raw = (receipt.rawResponse ?? {}) as Record<string, unknown>;
    const canonicalListing = raw.canonicalListing as Record<string, unknown> | undefined;
    const canonicalListingId =
      (typeof raw.canonicalListingId === 'string' && raw.canonicalListingId) ||
      (typeof raw.entityId === 'string' && raw.entityId) ||
      (typeof canonicalListing?.id === 'string' && canonicalListing.id) ||
      receipt.receiptId;
    if (!canonicalListingId) throw new Error('CATALOG_MAPPING_RECEIPT_INVALID');
    const outcome = raw.outcome === 'EXISTING_LISTING' ? 'EXISTING_LISTING' : 'CREATED';
    const mappedAt = this.nowIso();

    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO ${TABLE_CATALOG_IDENTITY_MAPPINGS} (
           account_id, organization_id, outlet_id, temp_listing_id, canonical_listing_id, outcome, mapped_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, organization_id, outlet_id, temp_listing_id)
         DO UPDATE SET canonical_listing_id = excluded.canonical_listing_id,
                       outcome = excluded.outcome,
                       mapped_at = excluded.mapped_at;`,
        [
          context.accountId,
          context.organizationId,
          context.outletId,
          payload.tempListingId,
          canonicalListingId,
          outcome,
          mappedAt,
        ],
      );
      await tx.run(
        `UPDATE ${TABLE_LOCAL_CATALOG_DRAFTS}
         SET canonical_listing_id = ?, state = 'SYNCED', conflict_json = NULL,
             last_error_code = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?;`,
        [canonicalListingId, mappedAt, context.accountId, context.organizationId, context.outletId, payload.tempListingId],
      );
      await tx.run(
        `UPDATE ${TABLE_CATALOG_MEDIA_JOBS}
         SET canonical_listing_id = ?, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?
           AND canonical_listing_id IS NULL;`,
        [canonicalListingId, mappedAt, context.accountId, context.organizationId, context.outletId, payload.tempListingId],
      );
    });

    return { tempListingId: payload.tempListingId, canonicalListingId, outcome, mappedAt };
  }

  async markCreateConflict(
    context: MerchantPartitionContext,
    command: OfflineCommandRecord,
    conflict: unknown,
  ): Promise<void> {
    if (command.commandType !== 'CATALOG_CREATE') return;
    const payload = JSON.parse(command.payloadJson) as CatalogCreatePayload;
    await this.db.run(
      `UPDATE ${TABLE_LOCAL_CATALOG_DRAFTS}
       SET state = 'CONFLICT', conflict_json = ?, last_error_code = 'CATALOG_DRAFT_CONFLICT', updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?;`,
      [JSON.stringify(conflict ?? {}), this.nowIso(), context.accountId, context.organizationId, context.outletId, payload.tempListingId],
    );
  }

  async markCreateRejected(
    context: MerchantPartitionContext,
    command: OfflineCommandRecord,
    errorCode: string,
  ): Promise<void> {
    if (command.commandType !== 'CATALOG_CREATE') return;
    const payload = JSON.parse(command.payloadJson) as CatalogCreatePayload;
    await this.db.run(
      `UPDATE ${TABLE_LOCAL_CATALOG_DRAFTS}
       SET state = 'REJECTED', last_error_code = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?;`,
      [errorCode, this.nowIso(), context.accountId, context.organizationId, context.outletId, payload.tempListingId],
    );
  }

  async getMapping(context: MerchantPartitionContext, tempListingId: string): Promise<CatalogIdentityMapping | null> {
    const row = await this.db.get<MappingRow>(
      `SELECT temp_listing_id, canonical_listing_id, outcome, mapped_at
       FROM ${TABLE_CATALOG_IDENTITY_MAPPINGS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND temp_listing_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, tempListingId],
    );
    return row ? {
      tempListingId: row.temp_listing_id,
      canonicalListingId: row.canonical_listing_id,
      outcome: row.outcome,
      mappedAt: row.mapped_at,
    } : null;
  }

  async resolveCanonicalListingId(context: MerchantPartitionContext, listingId: string): Promise<string> {
    if (!listingId.startsWith('local_')) return listingId;
    return (await this.getMapping(context, listingId))?.canonicalListingId ?? listingId;
  }

  async resolveCommandIdentity(
    context: MerchantPartitionContext,
    command: OfflineCommandRecord,
  ): Promise<OfflineCommandRecord> {
    if (command.commandType === 'CATALOG_CREATE') return command;
    const payload = JSON.parse(command.payloadJson) as Record<string, unknown>;
    if (typeof payload.listingId !== 'string' || !payload.listingId.startsWith('local_')) return command;
    const canonical = await this.resolveCanonicalListingId(context, payload.listingId);
    if (canonical === payload.listingId) return command;
    return Object.freeze({
      ...command,
      payloadJson: computeCanonicalPayloadJson({ ...payload, listingId: canonical }),
    });
  }

  async enqueueMediaJob(
    context: MerchantPartitionContext,
    input: {
      tempListingId: string;
      filename: string;
      contentType: CatalogMediaJob['contentType'];
      bytesBase64: string;
      sizeBytes: number;
      idempotencyKey?: string;
    },
  ): Promise<CatalogMediaJob> {
    if (input.sizeBytes <= 0 || input.sizeBytes > 5 * 1024 * 1024) throw new Error('CATALOG_MEDIA_INVALID');
    const mediaJobId = Crypto.randomUUID();
    const idempotencyKey = input.idempotencyKey ?? `catalog-media:${mediaJobId}`;
    const mapping = await this.getMapping(context, input.tempListingId);
    const now = this.nowIso();
    await this.db.run(
      `INSERT INTO ${TABLE_CATALOG_MEDIA_JOBS} (
         account_id, organization_id, outlet_id, media_job_id, temp_listing_id,
         canonical_listing_id, filename, content_type, bytes_base64, size_bytes,
         idempotency_key, state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?);`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        mediaJobId,
        input.tempListingId,
        mapping?.canonicalListingId ?? null,
        input.filename,
        input.contentType,
        input.bytesBase64,
        input.sizeBytes,
        idempotencyKey,
        now,
        now,
      ],
    );
    const created = await this.getMediaJob(context, mediaJobId);
    if (!created) throw new Error('CATALOG_MEDIA_JOB_PERSISTENCE_ERROR');
    return created;
  }

  async getMediaJob(context: MerchantPartitionContext, mediaJobId: string): Promise<CatalogMediaJob | null> {
    const row = await this.db.get<MediaRow>(
      `SELECT * FROM ${TABLE_CATALOG_MEDIA_JOBS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_job_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, mediaJobId],
    );
    return row ? mapMedia(row) : null;
  }

  async claimMediaJobs(context: MerchantPartitionContext, limit = 5): Promise<CatalogMediaJob[]> {
    const now = this.nowIso();
    const lease = new Date(this.clock() + 30_000).toISOString();
    return this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE ${TABLE_CATALOG_MEDIA_JOBS}
         SET state = 'RETRYABLE', lease_expires_at = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND state = 'UPLOADING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?;`,
        [now, context.accountId, context.organizationId, context.outletId, now],
      );
      const rows = await tx.all<MediaRow>(
        `SELECT * FROM ${TABLE_CATALOG_MEDIA_JOBS}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND canonical_listing_id IS NOT NULL AND state IN ('PENDING', 'RETRYABLE')
         ORDER BY created_at ASC LIMIT ?;`,
        [context.accountId, context.organizationId, context.outletId, limit],
      );
      const claimed: CatalogMediaJob[] = [];
      for (const row of rows) {
        const changed = await tx.run(
          `UPDATE ${TABLE_CATALOG_MEDIA_JOBS}
           SET state = 'UPLOADING', attempt_count = attempt_count + 1, lease_expires_at = ?, updated_at = ?
           WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_job_id = ?
             AND state IN ('PENDING', 'RETRYABLE');`,
          [lease, now, context.accountId, context.organizationId, context.outletId, row.media_job_id],
        );
        if (changed.changes > 0) claimed.push(mapMedia({ ...row, state: 'UPLOADING', attempt_count: row.attempt_count + 1, lease_expires_at: lease, updated_at: now }));
      }
      return claimed;
    });
  }

  async markMediaAcknowledged(context: MerchantPartitionContext, mediaJobId: string): Promise<void> {
    await this.setMediaState(context, mediaJobId, 'ACKNOWLEDGED', null);
  }

  async markMediaRetryable(context: MerchantPartitionContext, mediaJobId: string, errorCode: string): Promise<void> {
    await this.setMediaState(context, mediaJobId, 'RETRYABLE', errorCode);
  }

  async markMediaRejected(context: MerchantPartitionContext, mediaJobId: string, errorCode: string): Promise<void> {
    await this.setMediaState(context, mediaJobId, 'REJECTED', errorCode);
  }

  private async setMediaState(
    context: MerchantPartitionContext,
    mediaJobId: string,
    state: CatalogMediaJobState,
    errorCode: string | null,
  ): Promise<void> {
    await this.db.run(
      `UPDATE ${TABLE_CATALOG_MEDIA_JOBS}
       SET state = ?, lease_expires_at = NULL, last_error_code = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_job_id = ?;`,
      [state, errorCode, this.nowIso(), context.accountId, context.organizationId, context.outletId, mediaJobId],
    );
  }
}
