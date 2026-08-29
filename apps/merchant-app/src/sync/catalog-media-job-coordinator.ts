import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import { OfflineCatalogDraftRepository } from '../data/repositories/offline-catalog-draft-repository';
import {
  fetchCatalogListing,
  type CatalogMediaAsset,
  uploadCatalogMedia,
} from '../catalog/api';

export type CatalogMediaSyncSummary = {
  processed: number;
  acknowledged: number;
  retryable: number;
  rejected: number;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function decodeBase64Bytes(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('CATALOG_MEDIA_LOCAL_BYTES_INVALID');
  }
  const output: number[] = [];
  for (let offset = 0; offset < clean.length; offset += 4) {
    const chars = clean.slice(offset, offset + 4);
    const values = chars.split('').map((char) => (char === '=' ? 0 : BASE64_ALPHABET.indexOf(char)));
    if (values.some((part) => part < 0)) throw new Error('CATALOG_MEDIA_LOCAL_BYTES_INVALID');
    const combined = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    output.push((combined >> 16) & 0xff);
    if (chars[2] !== '=') output.push((combined >> 8) & 0xff);
    if (chars[3] !== '=') output.push(combined & 0xff);
  }
  return Uint8Array.from(output);
}

export class CatalogMediaJobCoordinator {
  private readonly drafts: OfflineCatalogDraftRepository;

  constructor(
    db: SqliteDatabase,
    private readonly fetchListing: typeof fetchCatalogListing = fetchCatalogListing,
    private readonly upload: typeof uploadCatalogMedia = uploadCatalogMedia,
    clock?: () => number,
  ) {
    this.drafts = new OfflineCatalogDraftRepository(db, clock);
  }

  async sync(context: MerchantPartitionContext, batchSize = 5): Promise<CatalogMediaSyncSummary> {
    const jobs = await this.drafts.claimMediaJobs(context, batchSize);
    let acknowledged = 0;
    let retryable = 0;
    let rejected = 0;

    for (const job of jobs) {
      if (!job.canonicalListingId) {
        await this.drafts.markMediaRetryable(context, job.mediaJobId, 'CATALOG_MAPPING_PENDING');
        retryable += 1;
        continue;
      }
      try {
        const listing = await this.fetchListing(context.outletId, job.canonicalListingId);
        const bytes = decodeBase64Bytes(job.bytesBase64);
        if (bytes.byteLength !== job.sizeBytes) throw new Error('CATALOG_MEDIA_LOCAL_BYTES_INVALID');
        const asset: CatalogMediaAsset = {
          uri: `memory://${job.mediaJobId}`,
          name: job.filename,
          type: job.contentType,
          size: job.sizeBytes,
          file: new Blob([bytes], { type: job.contentType }),
        };
        await this.upload(listing, asset, job.idempotencyKey);
        await this.drafts.markMediaAcknowledged(context, job.mediaJobId);
        acknowledged += 1;
      } catch (unknownError) {
        const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
        const terminal = new Set([
          'CATALOG_MEDIA_INVALID',
          'CATALOG_MEDIA_QUOTA_EXCEEDED',
          'MERCHANT_PERMISSION_REQUIRED',
          'PERMISSION_DENIED',
          'RESOURCE_NOT_FOUND',
          'AUTH_UNAUTHORIZED',
          'CATALOG_MEDIA_LOCAL_BYTES_INVALID',
        ]).has(error.name || error.message);
        if (terminal) {
          await this.drafts.markMediaRejected(context, job.mediaJobId, error.name || error.message);
          rejected += 1;
        } else {
          // Version conflict and storage/network errors are retried after reloading canonical listing state.
          await this.drafts.markMediaRetryable(context, job.mediaJobId, error.name || 'CATALOG_MEDIA_RETRYABLE');
          retryable += 1;
        }
      }
    }

    return { processed: jobs.length, acknowledged, retryable, rejected };
  }
}
