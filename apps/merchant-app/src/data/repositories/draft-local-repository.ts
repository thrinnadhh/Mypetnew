import * as Crypto from 'expo-crypto';
import { normalizeMerchantBarcode } from '../../barcode/model';
import type { BarcodeType, ListingKind } from '../../catalog/api';
import type { SqliteDatabase } from '../database/driver';
import { TABLE_CATALOG_DRAFTS } from '../database/schema';
import type {
  CatalogDraft,
  CatalogDraftStatus,
  CreateCatalogDraftInput,
  LocalDraftId,
} from '../models/draft-types';
import type { CatalogCreatePayload } from '../models/outbox-types';
import type { MerchantPartitionContext } from '../models/partition-context';
import { CommandOutboxRepository } from './command-outbox-repository';

type DraftRow = {
  account_id: string;
  organization_id: string;
  outlet_id: string;
  local_id: string;
  create_command_id: string | null;
  barcode_type: BarcodeType;
  normalized_barcode: string;
  name: string;
  kind: ListingKind;
  commerce_mode: 'COMMERCE' | 'VIEW_ONLY';
  mrp_paise: number;
  selling_price_paise: number;
  category: string;
  brand: string | null;
  description: string | null;
  pet_type: string | null;
  life_stage: string | null;
  pack_label: string | null;
  sku: string | null;
  status: CatalogDraftStatus;
  canonical_listing_id: string | null;
  rejection_code: string | null;
  rejection_details: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: DraftRow): CatalogDraft {
  return Object.freeze({
    accountId: row.account_id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    localId: row.local_id as LocalDraftId,
    createCommandId: row.create_command_id,
    barcodeType: row.barcode_type,
    normalizedBarcode: row.normalized_barcode,
    name: row.name,
    kind: row.kind,
    commerceMode: row.commerce_mode,
    mrpPaise: Number(row.mrp_paise),
    sellingPricePaise: Number(row.selling_price_paise),
    category: row.category,
    brand: row.brand,
    description: row.description,
    petType: row.pet_type,
    lifeStage: row.life_stage,
    packLabel: row.pack_label,
    sku: row.sku,
    status: row.status,
    canonicalListingId: row.canonical_listing_id,
    rejectionCode: row.rejection_code,
    rejectionDetails: row.rejection_details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function validateDraftValues(input: CreateCatalogDraftInput): void {
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error('LISTING_NAME_INVALID');
  if (!Number.isSafeInteger(input.mrpPaise) || !Number.isSafeInteger(input.sellingPricePaise)) {
    throw new Error('LISTING_PRICE_INVALID');
  }
  if (input.mrpPaise < 0 || input.sellingPricePaise < 0 || input.sellingPricePaise > input.mrpPaise) {
    throw new Error('LISTING_PRICE_INVALID');
  }
}

function cleanOptional(value: string | null | undefined, maxLength = 500): string | null {
  const clean = value?.trim() ?? '';
  if (!clean) return null;
  if (clean.length > maxLength) throw new Error('LISTING_METADATA_INVALID');
  return clean;
}

export class DraftLocalRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  async createDraft(
    context: MerchantPartitionContext,
    input: CreateCatalogDraftInput,
    localId: LocalDraftId = `local:${Crypto.randomUUID()}`,
  ): Promise<CatalogDraft> {
    validateDraftValues(input);
    const normalizedBarcode = normalizeMerchantBarcode(input.barcodeType, input.barcode);
    const existing = await this.findByBarcode(context, input.barcodeType, normalizedBarcode);
    if (existing && existing.status !== 'SYNCED') {
      throw new Error(`LOCAL_DRAFT_BARCODE_EXISTS:${existing.localId}`);
    }

    const now = this.nowIso();
    const commerceMode = input.kind === 'MEDICINE' ? 'VIEW_ONLY' : 'COMMERCE';
    await this.db.run(
      `INSERT INTO ${TABLE_CATALOG_DRAFTS} (
        account_id, organization_id, outlet_id, local_id, create_command_id,
        barcode_type, normalized_barcode, name, kind, commerce_mode,
        mrp_paise, selling_price_paise, category, brand, description,
        pet_type, life_stage, pack_label, sku, status, canonical_listing_id,
        rejection_code, rejection_details, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL, NULL, NULL, ?, ?);`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        localId,
        input.barcodeType,
        normalizedBarcode,
        input.name.trim(),
        input.kind,
        commerceMode,
        input.mrpPaise,
        input.sellingPricePaise,
        input.category?.trim() || 'other',
        cleanOptional(input.brand, 120),
        cleanOptional(input.description, 2000),
        cleanOptional(input.petType, 120),
        cleanOptional(input.lifeStage, 120),
        cleanOptional(input.packLabel, 120),
        cleanOptional(input.sku, 120),
        now,
        now,
      ],
    );
    const created = await this.getDraft(context, localId);
    if (!created) throw new Error('LOCAL_DRAFT_PERSISTENCE_FAILED');
    return created;
  }

  async getDraft(context: MerchantPartitionContext, localId: string): Promise<CatalogDraft | null> {
    const row = await this.db.get<DraftRow>(
      `SELECT * FROM ${TABLE_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND local_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, localId],
    );
    return row ? mapRow(row) : null;
  }

  async getByCreateCommandId(context: MerchantPartitionContext, commandId: string): Promise<CatalogDraft | null> {
    const row = await this.db.get<DraftRow>(
      `SELECT * FROM ${TABLE_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND create_command_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, commandId],
    );
    return row ? mapRow(row) : null;
  }

  async findByBarcode(
    context: MerchantPartitionContext,
    barcodeType: BarcodeType,
    rawBarcode: string,
  ): Promise<CatalogDraft | null> {
    const normalized = normalizeMerchantBarcode(barcodeType, rawBarcode);
    const row = await this.db.get<DraftRow>(
      `SELECT * FROM ${TABLE_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
         AND barcode_type = ? AND normalized_barcode = ?
       ORDER BY updated_at DESC LIMIT 1;`,
      [context.accountId, context.organizationId, context.outletId, barcodeType, normalized],
    );
    return row ? mapRow(row) : null;
  }

  async listDrafts(context: MerchantPartitionContext): Promise<CatalogDraft[]> {
    const rows = await this.db.all<DraftRow>(
      `SELECT * FROM ${TABLE_CATALOG_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
       ORDER BY updated_at DESC, local_id ASC;`,
      [context.accountId, context.organizationId, context.outletId],
    );
    return rows.map(mapRow);
  }

  async queueForSync(
    context: MerchantPartitionContext,
    localId: LocalDraftId,
    outbox: CommandOutboxRepository,
    installationId = 'inst_default',
  ): Promise<string> {
    const draft = await this.getDraft(context, localId);
    if (!draft) throw new Error('LOCAL_DRAFT_NOT_FOUND');
    if (draft.status === 'SYNCED') throw new Error('LOCAL_DRAFT_ALREADY_SYNCED');

    const stableUuid = localId.slice('local:'.length);
    const commandId = draft.createCommandId ?? `m7-create-${stableUuid}`;
    const payload: CatalogCreatePayload = {
      outletId: context.outletId,
      barcodeType: draft.barcodeType,
      barcode: draft.normalizedBarcode,
      name: draft.name,
      kind: draft.kind,
      mrpPaise: draft.mrpPaise,
      sellingPricePaise: draft.sellingPricePaise,
      category: draft.category,
      brand: draft.brand,
      description: draft.description,
      petType: draft.petType,
      lifeStage: draft.lifeStage,
      packLabel: draft.packLabel,
      sku: draft.sku,
    };

    const command = await outbox.enqueueCommand(context, {
      commandId,
      installationId,
      idempotencyKey: commandId,
      commandType: 'CATALOG_CREATE',
      payload,
    });

    await this.db.run(
      `UPDATE ${TABLE_CATALOG_DRAFTS}
       SET create_command_id = ?, status = 'QUEUED', rejection_code = NULL,
           rejection_details = NULL, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND local_id = ?;`,
      [command.commandId, this.nowIso(), context.accountId, context.organizationId, context.outletId, localId],
    );
    return command.commandId;
  }

  async markRejected(
    context: MerchantPartitionContext,
    commandId: string,
    code: string,
    details: string,
  ): Promise<void> {
    await this.markTerminal(context, commandId, 'REJECTED', code, details);
  }

  async markConflict(
    context: MerchantPartitionContext,
    commandId: string,
    code: string,
    details: string,
  ): Promise<void> {
    await this.markTerminal(context, commandId, 'CONFLICT', code, details);
  }

  private async markTerminal(
    context: MerchantPartitionContext,
    commandId: string,
    status: 'REJECTED' | 'CONFLICT',
    code: string,
    details: string,
  ): Promise<void> {
    await this.db.run(
      `UPDATE ${TABLE_CATALOG_DRAFTS}
       SET status = ?, rejection_code = ?, rejection_details = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND create_command_id = ?;`,
      [status, code, details, this.nowIso(), context.accountId, context.organizationId, context.outletId, commandId],
    );
  }
}
