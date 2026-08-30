import { merchantApiFetch } from '../auth/session';
import {
  type CatalogCreatePayload,
  type CatalogLifecyclePayload,
  type CatalogUpdatePayload,
  type InventoryAdjustmentPayload,
  type InventoryCountSubmitPayload,
  type InventoryDamagePayload,
  type InventoryExpiryPayload,
  type InventoryReceivingPayload,
  type InventoryReturnPayload,
  type InventoryShrinkagePayload,
  type InventoryTransferPayload,
  type OfflineCommandRecord,
  type ServerReceiptData,
  isSupportedCommandPayloadVersion,
} from '../data/models/outbox-types';

export type TransportResult =
  | { ok: true; status: number; data: unknown; receipt: ServerReceiptData }
  | { ok: false; status?: number; retryAfter?: string | null; error: Error };

export type ResolveReceiptResult =
  | { ok: true; found: true; receipt: ServerReceiptData }
  | { ok: true; found: false }
  | { ok: false; status?: number; errorCode: string; error: Error };

export type FetchFunction = (path: string, options?: RequestInit) => Promise<Response>;

export class SyncTransport {
  constructor(private readonly fetchFn: FetchFunction = merchantApiFetch) {}

  getFetchFn(): FetchFunction {
    return this.fetchFn;
  }

  async resolveReceipt(command: OfflineCommandRecord): Promise<ResolveReceiptResult> {
    try {
      const payload = JSON.parse(command.payloadJson) as Record<string, unknown>;
      const receiptPath = command.commandType === 'CATALOG_CREATE'
        ? '/api/v1/merchant/sync/create-receipts/resolve'
        : '/api/v1/merchant/sync/receipts/resolve';
      const response = await this.fetchFn(receiptPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MyPet-Command-Type': command.commandType,
          'X-MyPet-Payload-Schema-Version': String(command.payloadSchemaVersion),
        },
        body: JSON.stringify({
          idempotencyKey: command.idempotencyKey,
          commandType: command.commandType,
          payloadSchemaVersion: command.payloadSchemaVersion,
          payload,
        }),
      });

      if (response.status === 404) return { ok: true, found: false };
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
        const code = errorBody?.code ?? `HTTP_${response.status}`;
        const error = new Error(errorBody?.message ?? `HTTP ${response.status}`);
        error.name = code;
        return { ok: false, status: response.status, errorCode: code, error };
      }

      const data = (await response.json()) as Record<string, unknown>;
      return {
        ok: true,
        found: true,
        receipt: {
          receiptId: typeof data.receiptId === 'string' ? data.receiptId : command.idempotencyKey,
          entityId: typeof data.entityId === 'string' ? data.entityId : undefined,
          resultingVersion: typeof data.resultingVersion === 'number' ? data.resultingVersion : undefined,
          resultingOnHand: typeof data.resultingOnHand === 'number' ? data.resultingOnHand : undefined,
          resultingReserved: typeof data.resultingReserved === 'number' ? data.resultingReserved : undefined,
          serverTimestamp: typeof data.serverTimestamp === 'string' ? data.serverTimestamp : new Date().toISOString(),
          rawResponse: data,
        },
      };
    } catch (networkError) {
      const error = networkError instanceof Error ? networkError : new Error(String(networkError));
      return { ok: false, errorCode: 'NETWORK_ERROR', error };
    }
  }

  async dispatch(command: OfflineCommandRecord): Promise<TransportResult> {
    if (!isSupportedCommandPayloadVersion(command.commandType, command.payloadSchemaVersion)) {
      const error = new Error(
        `COMMAND_SCHEMA_UNSUPPORTED: Payload schema version ${command.payloadSchemaVersion} is not supported for ${command.commandType}`,
      );
      error.name = 'COMMAND_SCHEMA_UNSUPPORTED';
      return { ok: false, status: 400, error };
    }

    const payload = JSON.parse(command.payloadJson) as Record<string, unknown>;
    let path = '';
    let method = 'POST';
    let body: Record<string, unknown> = {};

    switch (command.commandType) {
      case 'INVENTORY_ADJUSTMENT': {
        const inv = payload as InventoryAdjustmentPayload;
        path = '/api/v1/merchant/inventory/adjustments';
        body = {
          outletId: inv.outletId,
          listingId: inv.listingId,
          quantityDelta: inv.quantityDelta,
          reason: inv.reason,
          referenceType: inv.referenceType ?? null,
          referenceId: inv.referenceId ?? null,
        };
        break;
      }
      case 'INVENTORY_RECEIVING': {
        const rec = payload as InventoryReceivingPayload;
        path = '/api/v1/merchant/inventory/receiving';
        body = {
          outletId: rec.outletId,
          listingId: rec.listingId,
          quantity: rec.quantity,
          referenceType: rec.referenceType ?? null,
          referenceId: rec.referenceId ?? null,
          batchNumber: rec.batchNumber ?? null,
          expiryDate: rec.expiryDate ?? null,
        };
        break;
      }
      case 'INVENTORY_DAMAGE': {
        const dam = payload as InventoryDamagePayload;
        path = '/api/v1/merchant/inventory/damage';
        body = {
          outletId: dam.outletId,
          listingId: dam.listingId,
          quantity: dam.quantity,
          reasonDetails: dam.reasonDetails ?? null,
          referenceId: dam.referenceId ?? null,
        };
        break;
      }
      case 'INVENTORY_EXPIRY': {
        const exp = payload as InventoryExpiryPayload;
        path = '/api/v1/merchant/inventory/expiry';
        body = {
          outletId: exp.outletId,
          listingId: exp.listingId,
          quantity: exp.quantity,
          batchReference: exp.batchReference ?? null,
          expiryDate: exp.expiryDate ?? null,
        };
        break;
      }
      case 'INVENTORY_SHRINKAGE': {
        const shr = payload as InventoryShrinkagePayload;
        path = '/api/v1/merchant/inventory/shrinkage';
        body = {
          outletId: shr.outletId,
          listingId: shr.listingId,
          quantity: shr.quantity,
          notes: shr.notes ?? null,
          referenceId: shr.referenceId ?? null,
        };
        break;
      }
      case 'INVENTORY_RETURN': {
        const ret = payload as InventoryReturnPayload;
        path = '/api/v1/merchant/inventory/returns';
        body = {
          outletId: ret.outletId,
          listingId: ret.listingId,
          quantity: ret.quantity,
          returnType: ret.returnType,
          referenceType: ret.referenceType ?? null,
          referenceId: ret.referenceId ?? null,
        };
        break;
      }
      case 'INVENTORY_TRANSFER': {
        const tr = payload as InventoryTransferPayload;
        path = '/api/v1/merchant/inventory/transfers';
        body = {
          sourceOutletId: tr.sourceOutletId,
          destinationOutletId: tr.destinationOutletId,
          sourceListingId: tr.sourceListingId,
          destinationListingId: tr.destinationListingId ?? null,
          quantity: tr.quantity,
        };
        break;
      }
      case 'INVENTORY_COUNT_SUBMIT': {
        const cnt = payload as InventoryCountSubmitPayload;
        path = `/api/v1/merchant/inventory/counts/${encodeURIComponent(cnt.sessionId)}/submit`;
        body = { outletId: cnt.outletId };
        break;
      }
      case 'CATALOG_CREATE': {
        const cat = payload as CatalogCreatePayload;
        path = '/api/v1/merchant/listings';
        body = {
          outletId: cat.outletId,
          barcodeType: cat.barcodeType,
          barcode: cat.barcode,
          name: cat.name,
          kind: cat.kind,
          mrpPaise: cat.mrpPaise,
          sellingPricePaise: cat.sellingPricePaise,
          category: cat.category,
          brand: cat.brand ?? null,
          description: cat.description ?? null,
          petType: cat.petType ?? null,
          lifeStage: cat.lifeStage ?? null,
          packLabel: cat.packLabel ?? null,
          sku: cat.sku ?? null,
          imageUrls: [],
        };
        break;
      }
      case 'CATALOG_UPDATE': {
        const cat = payload as CatalogUpdatePayload;
        path = `/api/v1/merchant/listings/${encodeURIComponent(cat.listingId)}`;
        method = 'PATCH';
        body = {
          outletId: cat.outletId,
          expectedVersion: cat.expectedVersion,
          name: cat.name,
          mrpPaise: cat.mrpPaise,
          sellingPricePaise: cat.sellingPricePaise,
          category: cat.category,
          brand: cat.brand ?? null,
          description: cat.description ?? null,
          petType: cat.petType ?? null,
          lifeStage: cat.lifeStage ?? null,
          packLabel: cat.packLabel ?? null,
          sku: cat.sku ?? null,
        };
        break;
      }
      case 'CATALOG_ACTIVATE': {
        const cat = payload as CatalogLifecyclePayload;
        path = `/api/v1/merchant/listings/${encodeURIComponent(cat.listingId)}/activate`;
        body = { outletId: cat.outletId, expectedVersion: cat.expectedVersion };
        break;
      }
      case 'CATALOG_DEACTIVATE': {
        const cat = payload as CatalogLifecyclePayload;
        path = `/api/v1/merchant/listings/${encodeURIComponent(cat.listingId)}/deactivate`;
        body = { outletId: cat.outletId, expectedVersion: cat.expectedVersion };
        break;
      }
      default: {
        const error = new Error(`COMMAND_SCHEMA_UNSUPPORTED: Unsupported command type ${(command as { commandType: string }).commandType}`);
        error.name = 'COMMAND_SCHEMA_UNSUPPORTED';
        return { ok: false, status: 400, error };
      }
    }

    try {
      const response = await this.fetchFn(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.idempotencyKey,
          'X-MyPet-Command-Type': command.commandType,
          'X-MyPet-Payload-Schema-Version': String(command.payloadSchemaVersion),
        },
        body: JSON.stringify(body),
      });
      const retryAfter = response.headers.get('Retry-After');
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          code?: string;
          message?: string;
          error?: string;
        } | null;
        const error = new Error(errorBody?.message ?? errorBody?.error ?? `HTTP ${response.status} from ${path}`);
        error.name = errorBody?.code ?? `HTTP_${response.status}`;
        return { ok: false, status: response.status, retryAfter, error };
      }

      const responseData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: true,
        status: response.status,
        data: responseData,
        receipt: {
          receiptId: typeof responseData.id === 'string' ? responseData.id : (typeof responseData.sessionId === 'string' ? responseData.sessionId : undefined),
          entityId: typeof responseData.id === 'string' ? responseData.id : (typeof responseData.sessionId === 'string' ? responseData.sessionId : undefined),
          resultingVersion: typeof responseData.version === 'number' ? responseData.version : undefined,
          resultingOnHand: typeof responseData.resultingOnHand === 'number' ? responseData.resultingOnHand : undefined,
          resultingReserved: typeof responseData.resultingReserved === 'number' ? responseData.resultingReserved : undefined,
          serverTimestamp: typeof responseData.updatedAt === 'string' ? responseData.updatedAt : (typeof responseData.submittedAt === 'string' ? responseData.submittedAt : new Date().toISOString()),
          rawResponse: responseData,
        },
      };
    } catch (networkError) {
      const error = networkError instanceof Error ? networkError : new Error(String(networkError));
      return { ok: false, error };
    }
  }
}
