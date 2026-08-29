import { normalizeMerchantBarcode } from '../../barcode/model';
import type {
  BarcodeType,
  CommerceMode,
  ListingKind,
  ListingStatus,
  MerchantListing,
} from '../../catalog/api';
import type { SqliteDatabase } from '../database/driver';
import { TABLE_CATALOG_BARCODES, TABLE_CATALOG_ITEMS } from '../database/schema';
import type { BarcodeLookupResult, LocalBarcodeMapping } from '../models/catalog-types';
import type { MerchantPartitionContext } from '../models/partition-context';

type BarcodeJoinDbRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  id: string;
  name: string;
  kind: string;
  commerce_mode: string;
  barcode_type: string;
  normalized_barcode: string;
  mrp_paise: number;
  selling_price_paise: number;
  category: string;
  brand: string | null;
  description: string | null;
  pet_type: string | null;
  life_stage: string | null;
  pack_label: string | null;
  sku: string | null;
  image_urls_json: string;
  status: string;
  version: number;
  server_created_at: string;
  server_updated_at: string;
};

function mapRowToListing(row: BarcodeJoinDbRow): MerchantListing {
  let imageUrls: string[] = [];
  try {
    imageUrls = JSON.parse(row.image_urls_json);
  } catch {
    imageUrls = [];
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    name: row.name,
    kind: row.kind as ListingKind,
    commerceMode: row.commerce_mode as CommerceMode,
    barcodeType: row.barcode_type as BarcodeType,
    normalizedBarcode: row.normalized_barcode,
    mrpPaise: Number(row.mrp_paise),
    sellingPricePaise: Number(row.selling_price_paise),
    category: row.category,
    brand: row.brand,
    description: row.description,
    petType: row.pet_type,
    lifeStage: row.life_stage,
    packLabel: row.pack_label,
    sku: row.sku,
    imageUrls,
    status: row.status as ListingStatus,
    version: Number(row.version),
    createdAt: row.server_created_at,
    updatedAt: row.server_updated_at,
  };
}

export type BarcodeLookupOptions = {
  includeInactive?: boolean;
};

export type OfflineBarcodeResolution =
  | { found: true; normalizedBarcode: string; barcodeType: BarcodeType; listing: MerchantListing }
  | { found: false; normalizedBarcode: string; barcodeType: BarcodeType; listing: null; ambiguous?: MerchantListing[] };

export class BarcodeLocalRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findByBarcode(
    context: MerchantPartitionContext,
    barcodeType: BarcodeType,
    rawBarcode: string,
    options: BarcodeLookupOptions = {},
  ): Promise<BarcodeLookupResult> {
    const normalizedBarcode = normalizeMerchantBarcode(barcodeType, rawBarcode);
    const statusClause = options.includeInactive ? '' : "AND i.status = 'ACTIVE'";

    const rows = await this.db.all<BarcodeJoinDbRow>(
      `SELECT
        i.account_id, i.organization_id, i.outlet_id, i.id, i.name, i.kind,
        i.commerce_mode, i.barcode_type, i.normalized_barcode, i.mrp_paise,
        i.selling_price_paise, i.category, i.brand, i.description, i.pet_type,
        i.life_stage, i.pack_label, i.sku, i.image_urls_json, i.status,
        i.version, i.server_created_at, i.server_updated_at
       FROM ${TABLE_CATALOG_BARCODES} b
       INNER JOIN ${TABLE_CATALOG_ITEMS} i
         ON b.account_id = i.account_id
        AND b.organization_id = i.organization_id
        AND b.outlet_id = i.outlet_id
        AND b.listing_id = i.id
       WHERE b.account_id = ?
         AND b.organization_id = ?
         AND b.outlet_id = ?
         AND b.barcode_type = ?
         AND b.normalized_barcode = ?
         AND b.is_tombstone = 0
         AND i.is_tombstone = 0
         ${statusClause}
       ORDER BY b.is_primary DESC, i.id ASC;`,
      [context.accountId, context.organizationId, context.outletId, barcodeType, normalizedBarcode],
    );

    if (rows.length === 0) {
      return { type: 'NOT_FOUND', normalizedBarcode, barcodeType };
    }
    if (rows.length === 1) {
      return { type: 'FOUND', listing: mapRowToListing(rows[0]) };
    }
    return {
      type: 'AMBIGUOUS',
      matches: rows.map(mapRowToListing),
      normalizedBarcode,
      barcodeType,
    };
  }

  async processScanOffline(
    context: MerchantPartitionContext,
    barcodeType: BarcodeType,
    rawBarcode: string,
  ): Promise<OfflineBarcodeResolution> {
    const result = await this.findByBarcode(context, barcodeType, rawBarcode);
    if (result.type === 'FOUND') {
      return {
        found: true,
        normalizedBarcode: result.listing.normalizedBarcode,
        barcodeType: result.listing.barcodeType,
        listing: result.listing,
      };
    }
    return {
      found: false,
      normalizedBarcode: result.normalizedBarcode,
      barcodeType: result.barcodeType,
      listing: null,
      ambiguous: result.type === 'AMBIGUOUS' ? result.matches : undefined,
    };
  }

  async upsertBarcodeMapping(
    context: MerchantPartitionContext,
    mapping: {
      listingId: string;
      barcodeType: BarcodeType;
      rawBarcode: string;
      isPrimary?: boolean;
    },
    updatedAt: string = new Date().toISOString(),
  ): Promise<LocalBarcodeMapping> {
    const normalizedBarcode = normalizeMerchantBarcode(mapping.barcodeType, mapping.rawBarcode);
    const isPrimary = mapping.isPrimary ? 1 : 0;

    await this.db.run(
      `INSERT INTO ${TABLE_CATALOG_BARCODES} (
        account_id, organization_id, outlet_id, listing_id, barcode_type,
        normalized_barcode, is_primary, is_tombstone, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(account_id, organization_id, outlet_id, listing_id, barcode_type, normalized_barcode) DO UPDATE SET
        is_primary = excluded.is_primary,
        is_tombstone = 0,
        updated_at = excluded.updated_at;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        mapping.listingId,
        mapping.barcodeType,
        normalizedBarcode,
        isPrimary,
        updatedAt,
      ],
    );

    return {
      accountId: context.accountId,
      organizationId: context.organizationId,
      outletId: context.outletId,
      listingId: mapping.listingId,
      barcodeType: mapping.barcodeType,
      normalizedBarcode,
      isPrimary: Boolean(mapping.isPrimary),
      isTombstone: false,
      updatedAt,
    };
  }
}
