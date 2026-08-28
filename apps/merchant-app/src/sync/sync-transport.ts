import { merchantApiFetch } from '../auth/session';
import {
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

  async fetchReceipt(outletId: string, idempotencyKey: string): Promise<ServerReceiptData | null> {
    try {
      const params = new URLSearchParams({ outletId });
      const response = await this.fetchFn(
        `/api/v1/merchant/sync/receipts/${encodeURIComponent(idempotencyKey)}?${params.toString()}`,
      );
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as Record<string, unknown>;
      return {
        receiptId: (data.receiptId as string) ?? (data.movementId as string) ?? idempotencyKey,
        resultingVersion: typeof data.resultingVersion === 'number' ? data.resultingVersion : undefined,
        resultingOnHand: typeof data.resultingOnHand === 'number' ? data.resultingOnHand : undefined,
        serverTimestamp: (data.createdAt as string) ?? new Date().toISOString(),
        rawResponse: data,
      };
    } catch {
      return null;
    }
  }

  async dispatch(command: OfflineCommandRecord): Promise<TransportResult> {
    // Validate payload schema version before attempting any network transport
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
        const errorMsg = errorBody?.message ?? errorBody?.error ?? `HTTP ${response.status} from ${path}`;
        const error = new Error(errorMsg);
        error.name = errorBody?.code ?? `HTTP_${response.status}`;
        return {
          ok: false,
          status: response.status,
          retryAfter,
          error,
        };
      }

      const responseData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const resultingVersion =
        typeof responseData.version === 'number'
          ? responseData.version
          : typeof responseData.resultingOnHand === 'number'
            ? undefined
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
        typeof responseData.id === 'string'
          ? responseData.id
          : undefined;

      const receipt: ServerReceiptData = {
        receiptId,
        resultingVersion,
        resultingOnHand,
        resultingReserved,
        serverTimestamp: new Date().toISOString(),
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
