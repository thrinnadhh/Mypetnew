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
