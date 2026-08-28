import * as Crypto from 'expo-crypto';

export type OfflineCommandType =
  | 'INVENTORY_ADJUSTMENT'
  | 'CATALOG_UPDATE'
  | 'CATALOG_ACTIVATE'
  | 'CATALOG_DEACTIVATE';

export type OfflineCommandState =
  | 'PENDING'
  | 'SENDING'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'RETRYABLE'
  | 'NEEDS_RECONCILIATION';

export type InventoryAdjustmentPayload = {
  outletId: string;
  listingId: string;
  quantityDelta: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
};

export type CatalogUpdatePayload = {
  outletId: string;
  listingId: string;
  expectedVersion: number;
  name: string;
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

export type CatalogLifecyclePayload = {
  outletId: string;
  listingId: string;
  expectedVersion: number;
  targetStatus: 'ACTIVE' | 'INACTIVE';
};

export type OfflineCommandPayload =
  | InventoryAdjustmentPayload
  | CatalogUpdatePayload
  | CatalogLifecyclePayload
  | Record<string, unknown>;

export type OfflineCommandRecord = Readonly<{
  commandId: string;
  accountId: string;
  organizationId: string;
  outletId: string;
  installationId: string;
  idempotencyKey: string;
  commandType: OfflineCommandType;
  payloadSchemaVersion: number;
  payloadJson: string;
  requestFingerprint: string;
  state: OfflineCommandState;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetails: string | null;
  durableServerReceipt: string | null;
  resultingVersion: number | null;
}>;

export type EnqueueCommandInput = {
  commandId?: string;
  installationId: string;
  idempotencyKey: string;
  commandType: OfflineCommandType;
  payloadSchemaVersion?: number;
  payload: OfflineCommandPayload;
  dependsOnCommandIds?: string[];
};

export type ClaimedCommand = {
  command: OfflineCommandRecord;
  leaseToken: string;
};

export type ServerReceiptData = {
  receiptId?: string;
  resultingVersion?: number;
  resultingOnHand?: number;
  resultingReserved?: number;
  serverTimestamp: string;
  rawResponse?: unknown;
};

/**
 * Deterministically sorts object keys for canonical JSON serialization.
 */
function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson);
  }
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(record[key]);
  }
  return result;
}

export function computeCanonicalPayloadJson(payload: unknown): string {
  return JSON.stringify(canonicalizeJson(payload));
}

export async function computeRequestFingerprint(
  commandType: OfflineCommandType,
  payload: unknown,
  schemaVersion = 1,
): Promise<string> {
  const canonicalPayload = computeCanonicalPayloadJson(payload);
  const raw = `${commandType}:v${schemaVersion}:${canonicalPayload}`;
  if (typeof Crypto.digestStringAsync === 'function') {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const msgUint8 = new TextEncoder().encode(raw);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto');
  return nodeCrypto.createHash('sha256').update(raw).digest('hex');
}
