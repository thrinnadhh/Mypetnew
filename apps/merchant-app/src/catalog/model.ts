import type {
  BarcodeType,
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
