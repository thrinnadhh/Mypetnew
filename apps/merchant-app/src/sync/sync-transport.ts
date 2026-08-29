import { merchantApiFetch } from '../auth/session';
import {
  type CatalogCreatePayload,
  type CatalogLifecyclePayload,
  type CatalogUpdatePayload,
  type InventoryAdjustmentPayload,
  type OfflineCommandRecord,
  type ServerReceiptData,
  isSupportedCommandPayloadVersion,
} from '../data/models/outbox-types';

export type TransportResult =
  | {
      ok: true;
      status: number;
      data: unknown;
      receipt: ServerReceiptData;
    }
  | {
      ok: false;
      status?: number;
      retryAfter?: string | null;
      error: Error;
      errorData?: unknown;
    };

export type ResolveReceiptResult =
  | {
      ok: true;
      found: true;
      receipt: ServerReceiptData;
    }
  | {
      ok: true;
      found: false;
    }
  | {
      ok: false;
      status?: number;
      errorCode: string;
      error: Error;
    };

export type FetchFunction = (
  path: string,
  options?: RequestInit,
) => Promise<Response>;

export class SyncTransport {
  constructor(private readonly fetchFn: FetchFunction = merchantApiFetch) {}

  getFetchFn(): FetchFunction {
    return this.fetchFn;
  }

  async resolveReceipt(command: OfflineCommandRecord): Promise<ResolveReceiptResult> {
    try {
      const payload = JSON.parse(command.payloadJson) as Record<string, unknown>;
      const path = command.commandType === 'CATALOG_CREATE'
        ? '/api/v1/merchant/sync/catalog/drafts/resolve'
        : '/api/v1/merchant/sync/receipts/resolve';
      const response = await this.fetchFn(path, {
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

      if (response.status === 404) {
        return { ok: true, found: false };
      }

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
        const code = errorBody?.code ?? `HTTP_${response.status}`;
        const message = errorBody?.message ?? `HTTP ${response.status}`;
        const error = new Error(message);
        error.name = code;
        return {
          ok: false,
          status: response.status,
          errorCode: code,
          error,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const receipt: ServerReceiptData = {
        receiptId: typeof data.receiptId === 'string' ? data.receiptId : command.idempotencyKey,
        resultingVersion: typeof data.resultingVersion === 'number' ? data.resultingVersion : undefined,
        resultingOnHand: typeof data.resultingOnHand === 'number' ? data.resultingOnHand : undefined,
        resultingReserved: typeof data.resultingReserved === 'number' ? data.resultingReserved : undefined,
        serverTimestamp: (data.serverTimestamp as string) ?? new Date().toISOString(),
        rawResponse: data,
      };

      return {
        ok: true,
        found: true,
        receipt,
      };
    } catch (networkError) {
      const error = networkError instanceof Error ? networkError : new Error(String(networkError));
      return {
        ok: false,
        errorCode: 'NETWORK_ERROR',
        error,
      };
    }
  }

  async dispatch(command: OfflineCommandRecord): Promise<TransportResult> {
    if (!isSupportedCommandPayloadVersion(command.commandType, command.payloadSchemaVersion)) {
      const error = new Error(
        `COMMAND_SCHEMA_UNSUPPORTED: Payload schema version ${command.payloadSchemaVersion} is not supported for ${command.commandType}`,
      );
      error.name = 'COMMAND_SCHEMA_UNSUPPORTED';
      return {
        ok: false,
        status: 400,
        error,
      };
    }

    const payload = JSON.parse(command.payloadJson) as Record<string, unknown>;

    let path = '';
    let method = 'POST';
    let body: Record<string, unknown> = {};

    switch (command.commandType) {
      case 'INVENTORY_ADJUSTMENT': {
        const inv = payload as InventoryAdjustmentPayload;
        path = '/api/v1/merchant/inventory/adjustments';
        method = 'POST';
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
      case 'CATALOG_CREATE': {
        const create = payload as CatalogCreatePayload;
        path = '/api/v1/merchant/sync/catalog/drafts/reconcile';
        method = 'POST';
        body = {
          tempListingId: create.tempListingId,
          outletId: create.outletId,
          barcodeType: create.barcodeType,
          barcode: create.barcode,
          name: create.name,
          kind: create.kind,
          mrpPaise: create.mrpPaise,
          sellingPricePaise: create.sellingPricePaise,
          category: create.category,
          brand: create.brand ?? null,
          description: create.description ?? null,
          petType: create.petType ?? null,
          lifeStage: create.lifeStage ?? null,
          packLabel: create.packLabel ?? null,
          sku: create.sku ?? null,
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
        method = 'POST';
        body = {
          outletId: cat.outletId,
          expectedVersion: cat.expectedVersion,
        };
        break;
      }
      case 'CATALOG_DEACTIVATE': {
        const cat = payload as CatalogLifecyclePayload;
        path = `/api/v1/merchant/listings/${encodeURIComponent(cat.listingId)}/deactivate`;
        method = 'POST';
        body = {
          outletId: cat.outletId,
          expectedVersion: cat.expectedVersion,
        };
        break;
      }
      default: {
        const error = new Error(`COMMAND_SCHEMA_UNSUPPORTED: Unsupported command type ${(command as { commandType: string }).commandType}`);
        error.name = 'COMMAND_SCHEMA_UNSUPPORTED';
        return {
          ok: false,
          status: 400,
          error,
        };
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
          outcome?: string;
          canonicalListingId?: string;
          canonicalListing?: unknown;
        } | null;
        const errorMsg = errorBody?.message ?? errorBody?.error ?? `HTTP ${response.status} from ${path}`;
        const error = new Error(errorMsg);
        error.name = errorBody?.code ?? (errorBody?.outcome === 'CONFLICT' ? 'CATALOG_DRAFT_CONFLICT' : `HTTP_${response.status}`);
        return {
          ok: false,
          status: response.status,
          retryAfter,
          error,
          errorData: errorBody,
        };
      }

      const responseData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const resultingVersion =
        typeof responseData.resultingVersion === 'number'
          ? responseData.resultingVersion
          : typeof responseData.version === 'number'
            ? responseData.version
            : undefined;

      const resultingOnHand =
        typeof responseData.resultingOnHand === 'number'
          ? responseData.resultingOnHand
          : undefined;

      const resultingReserved =
        typeof responseData.resultingReserved === 'number'
          ? responseData.resultingReserved
          : undefined;

      const receiptId =
        typeof responseData.receiptId === 'string'
          ? responseData.receiptId
          : typeof responseData.id === 'string'
            ? responseData.id
            : undefined;

      const receipt: ServerReceiptData = {
        receiptId,
        resultingVersion,
        resultingOnHand,
        resultingReserved,
        serverTimestamp: typeof responseData.serverTimestamp === 'string'
          ? responseData.serverTimestamp
          : new Date().toISOString(),
        rawResponse: responseData,
      };

      return {
        ok: true,
        status: response.status,
        data: responseData,
        receipt,
      };
    } catch (networkError) {
      const error = networkError instanceof Error ? networkError : new Error(String(networkError));
      return {
        ok: false,
        error,
      };
    }
  }
}
