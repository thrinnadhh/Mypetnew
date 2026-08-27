import type {
  BarcodeType,
  CatalogMediaAsset,
  CatalogMediaAttachment,
  CatalogMediaContentType,
  CreateListingInput,
  ListingKind,
  ListingStatus,
  MerchantListing,
  UpdateListingInput,
} from './api';

export type CatalogFormState = {
  barcodeType: BarcodeType;
  barcode: string;
  kind: ListingKind;
  name: string;
  mrpPaise: string;
  sellingPricePaise: string;
  category: string;
  brand: string;
  description: string;
  petType: string;
  lifeStage: string;
  packLabel: string;
  sku: string;
};

export type CatalogStatusFilter = ListingStatus | 'ALL';

export type CatalogListingCard = {
  stateLine: string;
  priceLine: string;
  metadataLine: string;
  actionLabel: string;
};

export type CatalogPickerAssetInput = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  file?: Blob | null;
};

export function emptyCatalogForm(): CatalogFormState {
  return {
    barcodeType: 'INTERNAL',
    barcode: '',
    kind: 'PRODUCT',
    name: '',
    mrpPaise: '',
    sellingPricePaise: '',
    category: 'other',
    brand: '',
    description: '',
    petType: '',
    lifeStage: '',
    packLabel: '',
    sku: '',
  };
}

export function parseCatalogPaise(value: string, field: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${field} must be a whole number of paise.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} is outside the supported range.`);
  return parsed;
}

export function canWriteCatalog(permissions: Record<string, string[]>, outletId: string | null): boolean {
  if (!outletId) return false;
  const granted = permissions[outletId] ?? [];
  return granted.includes('OWNER') || granted.includes('CATALOG_WRITE');
}

export function catalogAccessNotice(outletId: string | null, loading: boolean, canWrite: boolean): string | null {
  if (!outletId && !loading) return 'No authorized Merchant outlet is available.';
  if (outletId && !canWrite) return 'Read only: CATALOG_WRITE is not currently granted for this outlet.';
  return null;
}

export function catalogErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'The catalog action could not be completed.';
  if (error.name === 'CATALOG_VERSION_CONFLICT') {
    return 'This listing changed on the server. The latest version was reloaded.';
  }
  if (error.name === 'CATALOG_DUPLICATE') {
    return 'That barcode already identifies another listing in this outlet.';
  }
  if (error.name === 'MERCHANT_PERMISSION_REQUIRED' || error.name === 'RESOURCE_NOT_FOUND') {
    return 'Your current Merchant access does not allow this catalog action.';
  }
  if (error.name === 'CATALOG_MEDIA_QUOTA_EXCEEDED') {
    return 'This listing already has the maximum of 5 images.';
  }
  if (error.name === 'CATALOG_MEDIA_INVALID' || error.name === 'CATALOG_MEDIA_LOCAL_FILE_REQUIRED') {
    return 'Choose a local JPEG, PNG, or WebP image up to 5 MiB.';
  }
  if (
    error.name === 'CATALOG_MEDIA_STORE_UNAVAILABLE' ||
    error.name === 'CATALOG_MEDIA_FINALIZATION_FAILED' ||
    error.name === 'CATALOG_MEDIA_CLEANUP_QUEUE_UNAVAILABLE'
  ) {
    return 'The image was not finalized. Retry the same upload when storage is available.';
  }
  return error.message;
}

export function shouldReloadCatalogAfterError(error: unknown): boolean {
  return error instanceof Error && error.name === 'CATALOG_VERSION_CONFLICT';
}

export function catalogFormFromListing(listing: MerchantListing): CatalogFormState {
  return {
    barcodeType: listing.barcodeType,
    barcode: listing.normalizedBarcode,
    kind: listing.kind,
    name: listing.name,
    mrpPaise: String(listing.mrpPaise),
    sellingPricePaise: String(listing.sellingPricePaise),
    category: listing.category,
    brand: listing.brand ?? '',
    description: listing.description ?? '',
    petType: listing.petType ?? '',
    lifeStage: listing.lifeStage ?? '',
    packLabel: listing.packLabel ?? '',
    sku: listing.sku ?? '',
  };
}

export function mutableCatalogInput(form: CatalogFormState): UpdateListingInput {
  return {
    name: form.name,
    mrpPaise: parseCatalogPaise(form.mrpPaise, 'MRP'),
    sellingPricePaise: parseCatalogPaise(form.sellingPricePaise, 'Selling price'),
    category: form.category,
    brand: form.brand || null,
    description: form.description || null,
    petType: form.petType || null,
    lifeStage: form.lifeStage || null,
    packLabel: form.packLabel || null,
    sku: form.sku || null,
  };
}

export function createCatalogInput(form: CatalogFormState): CreateListingInput {
  return {
    ...mutableCatalogInput(form),
    barcodeType: form.barcodeType,
    barcode: form.barcode,
    kind: form.kind,
  };
}

export function nextCatalogStatus(current: ListingStatus): ListingStatus {
  return current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

export function catalogStatusSuccessMessage(status: ListingStatus): string {
  return status === 'ACTIVE' ? 'Listing activated.' : 'Listing deactivated.';
}

export function catalogSearchOptions(
  query: string,
  status: CatalogStatusFilter,
  page: number,
): { query: string; status?: ListingStatus; page: number; pageSize: number } {
  return {
    query,
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: 25,
  };
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function catalogIdentitySummary(listing: MerchantListing): string {
  return `${listing.kind} · ${listing.barcodeType} · ${listing.normalizedBarcode}`;
}

export function catalogPageLabel(page: number): string {
  return `Page ${page + 1}`;
}

export function catalogEditorTitle(listing: MerchantListing | null): string {
  return listing ? `Edit ${listing.name}` : 'Create listing';
}

export function catalogSaveButtonTitle(saving: boolean, listing: MerchantListing | null): string {
  if (saving) return 'Saving…';
  return listing ? 'Save versioned update' : 'Create listing';
}

export function catalogSelectedLabel(current: string, value: string): string {
  return current === value ? `✓ ${value}` : value;
}

export function catalogEmptyStateMessage(loading: boolean, itemCount: number): string | null {
  return !loading && itemCount === 0 ? 'No listings match this view.' : null;
}

export function catalogOutletLabel(outletId: string, selectedOutletId: string | null): string {
  const shortId = outletId.slice(0, 8);
  return outletId === selectedOutletId ? `✓ ${shortId}` : shortId;
}

export function catalogListingCard(listing: MerchantListing): CatalogListingCard {
  const skuSuffix = listing.sku ? ` · SKU ${listing.sku}` : '';
  return {
    stateLine: `${listing.status} · v${listing.version} · ${listing.commerceMode}`,
    priceLine: `${formatPaise(listing.sellingPricePaise)} · MRP ${formatPaise(listing.mrpPaise)}`,
    metadataLine: `${listing.category}${skuSuffix}`,
    actionLabel: listing.status === 'ACTIVE' ? 'Deactivate' : 'Activate',
  };
}

export const CATALOG_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const CATALOG_MEDIA_MAX_IMAGES = 5;

export function canUploadCatalogMedia(listing: MerchantListing): boolean {
  return listing.status === 'ACTIVE' && listing.imageUrls.length < CATALOG_MEDIA_MAX_IMAGES;
}

export function catalogMediaQuotaLabel(listing: MerchantListing): string {
  return `${listing.imageUrls.length}/${CATALOG_MEDIA_MAX_IMAGES} images`;
}

export function catalogMediaAssetFromPicker(input: CatalogPickerAssetInput): CatalogMediaAsset {
  const normalizedType = input.mimeType?.trim().toLowerCase();
  const supported = new Set<CatalogMediaContentType>(['image/jpeg', 'image/png', 'image/webp']);
  if (!normalizedType || !supported.has(normalizedType as CatalogMediaContentType)) {
    const error = new Error('Choose a local JPEG, PNG, or WebP image up to 5 MiB.');
    error.name = 'CATALOG_MEDIA_INVALID';
    throw error;
  }
  const type = normalizedType as CatalogMediaContentType;
  const fallbackExtension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  const asset: CatalogMediaAsset = {
    uri: input.uri,
    name: input.fileName?.trim() || `catalog-image.${fallbackExtension}`,
    type,
    size: input.fileSize,
    file: input.file,
  };
  validateCatalogMediaAsset(asset);
  return asset;
}

export function validateCatalogMediaAsset(asset: CatalogMediaAsset): void {
  const extension = asset.name.trim().split('.').pop()?.toLowerCase() ?? '';
  const allowedExtension =
    (asset.type === 'image/jpeg' && (extension === 'jpg' || extension === 'jpeg')) ||
    (asset.type === 'image/png' && extension === 'png') ||
    (asset.type === 'image/webp' && extension === 'webp');
  if (
    !asset.name.trim() ||
    !allowedExtension ||
    (asset.size != null && (asset.size <= 0 || asset.size > CATALOG_MEDIA_MAX_BYTES))
  ) {
    const error = new Error('Choose a local JPEG, PNG, or WebP image up to 5 MiB.');
    error.name = 'CATALOG_MEDIA_INVALID';
    throw error;
  }
  if (!asset.file && !/^(file|content|ph|blob):/i.test(asset.uri)) {
    const error = new Error('Catalog media must come from a local device file.');
    error.name = 'CATALOG_MEDIA_LOCAL_FILE_REQUIRED';
    throw error;
  }
}

export function applyCatalogMediaAttachment(
  listing: MerchantListing,
  attachment: CatalogMediaAttachment,
): MerchantListing {
  if (attachment.listingId !== listing.id || attachment.position !== listing.imageUrls.length) {
    const error = new Error('The server media state changed; reload the listing.');
    error.name = 'CATALOG_VERSION_CONFLICT';
    throw error;
  }
  return {
    ...listing,
    imageUrls: [...listing.imageUrls, attachment.publicUrl],
    version: attachment.listingVersion,
  };
}
