import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../database/driver';
import { TABLE_PENDING_MEDIA } from '../database/schema';
import type { LocalDraftId, PendingMedia, PendingMediaStatus } from '../models/draft-types';
import type { MerchantPartitionContext } from '../models/partition-context';

type MediaRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  media_id: string;
  local_listing_id: LocalDraftId;
  canonical_listing_id: string | null;
  local_uri: string;
  mime_type: string;
  status: PendingMediaStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: MediaRow): PendingMedia {
  return Object.freeze({
    accountId: row.account_id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    mediaId: row.media_id,
    localListingId: row.local_listing_id,
    canonicalListingId: row.canonical_listing_id,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class PendingMediaRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  async add(
    context: MerchantPartitionContext,
    localListingId: LocalDraftId,
    localUri: string,
    mimeType: string,
    mediaId = Crypto.randomUUID(),
  ): Promise<PendingMedia> {
    if (!localListingId.startsWith('local:')) throw new Error('LOCAL_DRAFT_ID_REQUIRED');
    if (!localUri.trim()) throw new Error('LOCAL_MEDIA_URI_REQUIRED');
    if (!/^image\/(jpeg|png|webp)$/i.test(mimeType)) throw new Error('LISTING_IMAGE_INVALID');
    const now = this.nowIso();
    await this.db.run(
      `INSERT INTO ${TABLE_PENDING_MEDIA} (
        account_id, organization_id, outlet_id, media_id, local_listing_id,
        canonical_listing_id, local_uri, mime_type, status, attempt_count,
        next_attempt_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'WAITING_FOR_IDENTITY', 0, NULL, NULL, ?, ?);`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        mediaId,
        localListingId,
        localUri,
        mimeType.toLowerCase(),
        now,
        now,
      ],
    );
    const created = await this.get(context, mediaId);
    if (!created) throw new Error('PENDING_MEDIA_PERSISTENCE_FAILED');
    return created;
  }

  async get(context: MerchantPartitionContext, mediaId: string): Promise<PendingMedia | null> {
    const row = await this.db.get<MediaRow>(
      `SELECT * FROM ${TABLE_PENDING_MEDIA}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, mediaId],
    );
    return row ? mapRow(row) : null;
  }

  async list(context: MerchantPartitionContext): Promise<PendingMedia[]> {
    const rows = await this.db.all<MediaRow>(
      `SELECT * FROM ${TABLE_PENDING_MEDIA}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
       ORDER BY created_at ASC, media_id ASC;`,
      [context.accountId, context.organizationId, context.outletId],
    );
    return rows.map(mapRow);
  }

  async claimNextReady(context: MerchantPartitionContext): Promise<PendingMedia | null> {
    const now = this.nowIso();
    return this.db.transaction(async (tx) => {
      const row = await tx.get<MediaRow>(
        `SELECT * FROM ${TABLE_PENDING_MEDIA}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND canonical_listing_id IS NOT NULL
           AND status IN ('QUEUED', 'FAILED', 'UPLOADING')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC, media_id ASC LIMIT 1;`,
        [context.accountId, context.organizationId, context.outletId, now],
      );
      if (!row) return null;
      await tx.run(
        `UPDATE ${TABLE_PENDING_MEDIA}
         SET status = 'UPLOADING', attempt_count = attempt_count + 1,
             next_attempt_at = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_id = ?;`,
        [now, context.accountId, context.organizationId, context.outletId, row.media_id],
      );
      return mapRow({ ...row, status: 'UPLOADING', attempt_count: row.attempt_count + 1, next_attempt_at: null, updated_at: now });
    });
  }

  async markUploaded(context: MerchantPartitionContext, mediaId: string): Promise<void> {
    await this.db.run(
      `UPDATE ${TABLE_PENDING_MEDIA}
       SET status = 'UPLOADED', next_attempt_at = NULL, last_error = NULL, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_id = ?;`,
      [this.nowIso(), context.accountId, context.organizationId, context.outletId, mediaId],
    );
  }

  async markFailed(
    context: MerchantPartitionContext,
    mediaId: string,
    error: string,
    retryDelayMs: number,
  ): Promise<void> {
    const next = new Date(this.clock() + Math.max(0, retryDelayMs)).toISOString();
    await this.db.run(
      `UPDATE ${TABLE_PENDING_MEDIA}
       SET status = 'FAILED', next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND media_id = ?;`,
      [next, error.slice(0, 1000), this.nowIso(), context.accountId, context.organizationId, context.outletId, mediaId],
    );
  }
}
