import type { BarcodeType, CommerceMode, ListingKind } from '../../catalog/api';

export type LocalDraftId = `local:${string}`;
export type CatalogDraftStatus = 'DRAFT' | 'QUEUED' | 'SYNCED' | 'REJECTED' | 'CONFLICT';
export type PendingMediaStatus = 'WAITING_FOR_IDENTITY' | 'QUEUED' | 'UPLOADING' | 'FAILED' | 'UPLOADED';

export type CreateCatalogDraftInput = {
  barcodeType: BarcodeType;
  barcode: string;
  name: string;
  kind: ListingKind;
  mrpPaise: number;
  sellingPricePaise: number;
  category?: string;
  brand?: string | null;
  description?: string | null;
  petType?: string | null;
  lifeStage?: string | null;
  packLabel?: string | null;
  sku?: string | null;
};

export type CatalogDraft = Readonly<{
  accountId: string;
  organizationId: string;
  outletId: string;
  localId: LocalDraftId;
  createCommandId: string | null;
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  name: string;
  kind: ListingKind;
  commerceMode: CommerceMode;
  mrpPaise: number;
  sellingPricePaise: number;
  category: string;
  brand: string | null;
  description: string | null;
  petType: string | null;
  lifeStage: string | null;
  packLabel: string | null;
  sku: string | null;
  status: CatalogDraftStatus;
  canonicalListingId: string | null;
  rejectionCode: string | null;
  rejectionDetails: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PendingMedia = Readonly<{
  accountId: string;
  organizationId: string;
  outletId: string;
  mediaId: string;
  localListingId: LocalDraftId;
  canonicalListingId: string | null;
  localUri: string;
  mimeType: string;
  status: PendingMediaStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export function isLocalDraftId(value: string): value is LocalDraftId {
  return /^local:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
