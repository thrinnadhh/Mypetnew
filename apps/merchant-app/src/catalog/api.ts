import * as Crypto from 'expo-crypto';
import { merchantApiFetch } from '../auth/session';

export type ListingStatus = 'ACTIVE' | 'INACTIVE';
export type ListingKind = 'PRODUCT' | 'MEDICINE';
export type CommerceMode = 'COMMERCE' | 'VIEW_ONLY';
export type BarcodeType = 'GTIN_8' | 'GTIN_12' | 'GTIN_13' | 'GTIN_14' | 'INTERNAL';
export type CatalogMediaContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export type MerchantCatalogContext = {
  organizationId: string | null;
  outletIds: string[];
  permissionsByOutlet: Record<string, string[]>;
};

export type MerchantListing = {
  id: string;
  organizationId: string;
  outletId: string;
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  name: string;
  kind: ListingKind;
  commerceMode: CommerceMode;
  mrpPaise: number;
  sellingPricePaise: number;
  category: string;
  brand?: string | null;
  description?: string | null;
  petType?: string | null;
  lifeStage?: string | null;
  packLabel?: string | null;
  sku?: string | null;
  imageUrls: string[];
  status: ListingStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CatalogPage = {
  items: MerchantListing[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export type CatalogMediaAsset = {
  uri: string;
  name: string;
  type: CatalogMediaContentType;
  size?: number | null;
  file?: Blob | null;
};

export type CatalogMediaAttachment = {
  mediaId: string;
  listingId: string;
  position: number;
  publicUrl: string;
  contentType: CatalogMediaContentType;
  sizeBytes: number;
  listingVersion: number;
};

export type CreateListingInput = {
  barcodeType: BarcodeType;
  barcode: string;
  name: string;
  kind: ListingKind;
  mrpPaise: number;
  sellingPricePaise: number;
  category: string;
  brand?: string | null;
  description?: string | null;
  petType?: string | null;
  lifeStage?: string | null;
  packLabel?: string | null;
  sku?: string | null;
};

export type UpdateListingInput = Omit<CreateListingInput, 'barcodeType' | 'barcode' | 'kind'>;

type ApiErrorBody = { code?: string; message?: string; error?: string };

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const error = new Error(body?.message ?? body?.error ?? fallback);
  if (body?.code) error.name = body.code;
  return error;
}

function commandKey(prefix: string): string {
  return `${prefix}:${Crypto.randomUUID()}`;
}

export function catalogMediaCommandKey(): string {
  return commandKey('catalog-media');
}

export async function fetchMerchantCatalogContext(): Promise<MerchantCatalogContext> {
  const response = await merchantApiFetch('/api/v1/merchant/context');
  if (!response.ok) throw await apiError(response, 'Could not load Merchant catalog access.');
  return (await response.json()) as MerchantCatalogContext;
}

export async function fetchCatalogPage(
  outletId: string,
  options: { query?: string; status?: ListingStatus; page?: number; pageSize?: number } = {},
): Promise<CatalogPage> {
  const params = new URLSearchParams({
    outletId,
    page: String(options.page ?? 0),
    pageSize: String(options.pageSize ?? 25),
  });
  if (options.query?.trim()) params.set('query', options.query.trim());
  if (options.status) params.set('status', options.status);
  const response = await merchantApiFetch(`/api/v1/merchant/listings?${params.toString()}`);
  if (!response.ok) throw await apiError(response, 'Could not load catalog listings.');
  return (await response.json()) as CatalogPage;
}

export async function createListing(outletId: string, input: CreateListingInput): Promise<MerchantListing> {
  const response = await merchantApiFetch('/api/v1/merchant/listings', {
    method: 'POST',
    headers: { 'Idempotency-Key': commandKey('catalog-create') },
    body: JSON.stringify({ outletId, ...input }),
  });
  if (!response.ok) throw await apiError(response, 'Could not create listing.');
  return (await response.json()) as MerchantListing;
}

export async function updateListing(listing: MerchantListing, input: UpdateListingInput): Promise<MerchantListing> {
  const response = await merchantApiFetch(`/api/v1/merchant/listings/${encodeURIComponent(listing.id)}`, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': commandKey('catalog-update') },
    body: JSON.stringify({ outletId: listing.outletId, expectedVersion: listing.version, ...input }),
  });
  if (!response.ok) throw await apiError(response, 'Could not update listing.');
  return (await response.json()) as MerchantListing;
}

export async function changeListingStatus(
  listing: MerchantListing,
  target: ListingStatus,
): Promise<MerchantListing> {
  const action = target === 'ACTIVE' ? 'activate' : 'deactivate';
  const response = await merchantApiFetch(
    `/api/v1/merchant/listings/${encodeURIComponent(listing.id)}/${action}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': commandKey(`catalog-${action}`) },
      body: JSON.stringify({ outletId: listing.outletId, expectedVersion: listing.version }),
    },
  );
  if (!response.ok) throw await apiError(response, `Could not ${action} listing.`);
  return (await response.json()) as MerchantListing;
}

export async function uploadCatalogMedia(
  listing: MerchantListing,
  asset: CatalogMediaAsset,
  idempotencyKey: string,
): Promise<CatalogMediaAttachment> {
  const boundary = `mypetnew-${Crypto.randomUUID().replace(/-/g, '')}`;
  const safeFilename = asset.name.replace(/["\r\n\\/]/g, '_');
  const file = asset.file ?? await fetch(asset.uri).then(async (response) => {
    if (!response.ok) throw new Error('Could not read the selected image.');
    return response.blob();
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${asset.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`,
  ], { type: `multipart/form-data; boundary=${boundary}` });

  const params = new URLSearchParams({
    outletId: listing.outletId,
    expectedVersion: String(listing.version),
  });
  const response = await merchantApiFetch(
    `/api/v1/merchant/listings/${encodeURIComponent(listing.id)}/media?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!response.ok) throw await apiError(response, 'Could not upload the catalog image.');
  return (await response.json()) as CatalogMediaAttachment;
}
