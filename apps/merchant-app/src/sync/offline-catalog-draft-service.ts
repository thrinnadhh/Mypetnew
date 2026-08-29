import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import {
  computeCanonicalPayloadJson,
  type CatalogCreatePayload,
  type OfflineCommandRecord,
} from '../data/models/outbox-types';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import {
  type LocalCatalogDraft,
  OfflineCatalogDraftRepository,
} from '../data/repositories/offline-catalog-draft-repository';

export type QueueCatalogDraftInput = Omit<CatalogCreatePayload, 'tempListingId' | 'outletId'> & {
  tempListingId?: string;
};

export type QueuedCatalogDraft = {
  draft: LocalCatalogDraft;
  command: OfflineCommandRecord;
};

function canonicalDraftInput(context: MerchantPartitionContext, draft: LocalCatalogDraft): string {
  return computeCanonicalPayloadJson({
    tempListingId: draft.tempListingId,
    outletId: context.outletId,
    barcodeType: draft.barcodeType,
    barcode: draft.barcode,
    name: draft.name,
    kind: draft.kind,
    mrpPaise: draft.mrpPaise,
    sellingPricePaise: draft.sellingPricePaise,
    category: draft.category,
    brand: draft.brand ?? null,
    description: draft.description ?? null,
    petType: draft.petType ?? null,
    lifeStage: draft.lifeStage ?? null,
    packLabel: draft.packLabel ?? null,
    sku: draft.sku ?? null,
  });
}

function canonicalQueueInput(
  context: MerchantPartitionContext,
  tempListingId: string,
  input: QueueCatalogDraftInput,
): string {
  return computeCanonicalPayloadJson({
    tempListingId,
    outletId: context.outletId,
    barcodeType: input.barcodeType,
    barcode: input.barcode,
    name: input.name,
    kind: input.kind,
    mrpPaise: input.mrpPaise,
    sellingPricePaise: input.sellingPricePaise,
    category: input.category,
    brand: input.brand ?? null,
    description: input.description ?? null,
    petType: input.petType ?? null,
    lifeStage: input.lifeStage ?? null,
    packLabel: input.packLabel ?? null,
    sku: input.sku ?? null,
  });
}

export class OfflineCatalogDraftService {
  private readonly drafts: OfflineCatalogDraftRepository;
  private readonly outbox: CommandOutboxRepository;

  constructor(
    db: SqliteDatabase,
    private readonly installationId: string,
    clock?: () => number,
  ) {
    if (!installationId.trim()) throw new Error('INSTALLATION_ID_REQUIRED');
    this.drafts = new OfflineCatalogDraftRepository(db, clock);
    this.outbox = new CommandOutboxRepository(db, clock);
  }

  getDraftRepository(): OfflineCatalogDraftRepository {
    return this.drafts;
  }

  async queueDraft(
    context: MerchantPartitionContext,
    input: QueueCatalogDraftInput,
  ): Promise<QueuedCatalogDraft> {
    const draft = await this.drafts.createDraft(context, input);
    if (canonicalDraftInput(context, draft) !== canonicalQueueInput(context, draft.tempListingId, input)) {
      throw new Error('LOCAL_DRAFT_IMMUTABILITY_VIOLATION');
    }
    const command = await this.ensureCreateCommand(context, draft);
    return { draft: (await this.drafts.getDraft(context, draft.tempListingId)) ?? draft, command };
  }

  async recoverUnqueuedDrafts(context: MerchantPartitionContext): Promise<number> {
    const drafts = await this.drafts.listDrafts(context);
    let recovered = 0;
    for (const draft of drafts) {
      if (draft.state === 'LOCAL_DRAFT' && !draft.createCommandId) {
        await this.ensureCreateCommand(context, draft);
        recovered += 1;
      }
    }
    return recovered;
  }

  private async ensureCreateCommand(
    context: MerchantPartitionContext,
    draft: LocalCatalogDraft,
  ): Promise<OfflineCommandRecord> {
    if (draft.createCommandId) {
      const existing = await this.outbox.getCommand(context, draft.createCommandId);
      if (existing) return existing;
    }

    const commandId = `draft-create-${Crypto.randomUUID()}`;
    const idempotencyKey = `catalog-create:${draft.tempListingId.replace(/^local_/, '')}`;
    const payload: CatalogCreatePayload = {
      tempListingId: draft.tempListingId,
      outletId: context.outletId,
      barcodeType: draft.barcodeType,
      barcode: draft.barcode,
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

    const command = await this.outbox.enqueueCommand(context, {
      commandId,
      installationId: this.installationId,
      idempotencyKey,
      commandType: 'CATALOG_CREATE',
      payloadSchemaVersion: 1,
      payload,
    });
    await this.drafts.attachCreateCommand(context, draft.tempListingId, command.commandId);
    return command;
  }
}
