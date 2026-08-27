import type {
  BarcodeType,
  CommerceMode,
  ListingKind,
  ListingStatus,
  MerchantListing,
} from '../../catalog/api';

export type LocalCatalogItem = {
  accountId: string;
  organizationId: string;
  outletId: string;
  id: string;
  name: string;
  kind: ListingKind;
  commerceMode: CommerceMode;
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  mrpPaise: number;
  sellingPricePaise: number;
  category: string;
  brand: string | null;
  description: string | null;
  petType: string | null;
  lifeStage: string | null;
  packLabel: string | null;
  sku: string | null;
  imageUrls: string[];
  status: ListingStatus;
  version: number;
  isTombstone: boolean;
  tombstonedAt: string | null;
  serverCreatedAt: string;
  serverUpdatedAt: string;
  localUpdatedAt: string;
};

export type LocalBarcodeMapping = {
  accountId: string;
  organizationId: string;
  outletId: string;
  listingId: string;
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  isPrimary: boolean;
  isTombstone: boolean;
  updatedAt: string;
};

export type BarcodeLookupResult =
  | { type: 'FOUND'; listing: MerchantListing }
  | { type: 'NOT_FOUND'; normalizedBarcode: string; barcodeType: BarcodeType }
  | { type: 'AMBIGUOUS'; matches: MerchantListing[]; normalizedBarcode: string; barcodeType: BarcodeType };

export type CatalogProjectionBatch = {
  items: MerchantListing[];
  tombstones?: Array<{ id: string; updatedAt: string }>;
  cursor?: string | null;
};
