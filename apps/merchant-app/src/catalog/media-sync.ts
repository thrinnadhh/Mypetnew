import { uploadCatalogMedia, type CatalogMediaAsset, type CatalogMediaContentType } from './api';
import { validateCatalogMediaAsset } from './model';
import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import { CatalogLocalRepository } from '../data/repositories/catalog-local-repository';
import { PendingMediaRepository } from '../data/repositories/pending-media-repository';

export type MediaSyncSummary = {
  attempted: number;
  uploaded: number;
  failed: number;
};

export class MediaReconciliationCoordinator {
  private readonly mediaRepo: PendingMediaRepository;
  private readonly catalogRepo: CatalogLocalRepository;

  constructor(
    db: SqliteDatabase,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.mediaRepo = new PendingMediaRepository(db, clock);
    this.catalogRepo = new CatalogLocalRepository(db);
  }

  async sync(context: MerchantPartitionContext, maxItems = 5): Promise<MediaSyncSummary> {
    let attempted = 0;
    let uploaded = 0;
    let failed = 0;

    while (attempted < maxItems) {
      const media = await this.mediaRepo.claimNextReady(context);
      if (!media) break;
      attempted += 1;

      try {
        if (!media.canonicalListingId) throw new Error('CANONICAL_LISTING_ID_REQUIRED');
        const listing = await this.catalogRepo.getListingById(context, media.canonicalListingId);
        if (!listing) throw new Error('CANONICAL_LISTING_NOT_CACHED');
        const filename = media.localUri.split('/').pop()?.split('?')[0] || 'catalog-image';
        const asset: CatalogMediaAsset = {
          uri: media.localUri,
          name: filename,
          type: media.mimeType as CatalogMediaContentType,
        };
        validateCatalogMediaAsset(asset);
        await uploadCatalogMedia(listing, asset, `m7-media-${media.mediaId}`);
        await this.mediaRepo.markUploaded(context, media.mediaId);
        uploaded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const exponential = Math.min(60_000, 1000 * 2 ** Math.min(media.attemptCount, 6));
        await this.mediaRepo.markFailed(context, media.mediaId, message, exponential);
        failed += 1;
      }
    }

    return { attempted, uploaded, failed };
  }
}
