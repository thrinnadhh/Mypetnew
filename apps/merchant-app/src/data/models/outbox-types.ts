import * as Crypto from 'expo-crypto';

export type OfflineCommandType =
  | 'INVENTORY_ADJUSTMENT'
  | 'INVENTORY_RECEIVING'
  | 'INVENTORY_DAMAGE'
  | 'INVENTORY_EXPIRY'
  | 'INVENTORY_SHRINKAGE'
  | 'INVENTORY_RETURN'
  | 'INVENTORY_TRANSFER'
  | 'INVENTORY_COUNT_SUBMIT'
  | 'CATALOG_CREATE'
  | 'CATALOG_UPDATE'
  | 'CATALOG_ACTIVATE'
  | 'CATALOG_DEACTIVATE';

export const SUPPORTED_COMMAND_PAYLOAD_VERSIONS: Record<OfflineCommandType, readonly number[]> = {
  INVENTORY_ADJUSTMENT: [1],
  INVENTORY_RECEIVING: [1],
  INVENTORY_DAMAGE: [1],
  INVENTORY_EXPIRY: [1],
  INVENTORY_SHRINKAGE: [1],
  INVENTORY_RETURN: [1],
  INVENTORY_TRANSFER: [1],
  INVENTORY_COUNT_SUBMIT: [1],
  CATALOG_CREATE: [1],
  CATALOG_UPDATE: [1],
  CATALOG_ACTIVATE: [1],
  CATALOG_DEACTIVATE: [1],
};

export function isSupportedCommandPayloadVersion(
  commandType: OfflineCommandType,
  version: number,
): boolean {
  const supported = SUPPORTED_COMMAND_PAYLOAD_VERSIONS[commandType];
  return !!supported && supported.includes(version);
}

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

export type InventoryReceivingPayload = {
  outletId: string;
  listingId: string;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
};

export type InventoryDamagePayload = {
  outletId: string;
  listingId: string;
  quantity: number;
  reasonDetails?: string | null;
  referenceId?: string | null;
};

export type InventoryExpiryPayload = {
  outletId: string;
  listingId: string;
  quantity: number;
  batchReference?: string | null;
  expiryDate?: string | null;
};

export type InventoryShrinkagePayload = {
  outletId: string;
  listingId: string;
  quantity: number;
  notes?: string | null;
  referenceId?: string | null;
};

export type InventoryReturnPayload = {
  outletId: string;
  listingId: string;
  quantity: number;
  returnType: 'CUSTOMER_RETURN' | 'VENDOR_RETURN';
  referenceType?: string | null;
  referenceId?: string | null;
};

export type InventoryTransferPayload = {
  sourceOutletId: string;
  destinationOutletId: string;
  sourceListingId: string;
  destinationListingId?: string | null;
  quantity: number;
};

export type InventoryCountSubmitPayload = {
  outletId: string;
  sessionId: string;
};

export type CatalogCreatePayload = {
  outletId: string;
  barcodeType: 'GTIN_8' | 'GTIN_12' | 'GTIN_13' | 'GTIN_14' | 'INTERNAL';
  barcode: string;
  name: string;
  kind: 'PRODUCT' | 'MEDICINE';
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
  | InventoryReceivingPayload
  | InventoryDamagePayload
  | InventoryExpiryPayload
  | InventoryShrinkagePayload
  | InventoryReturnPayload
  | InventoryTransferPayload
  | InventoryCountSubmitPayload
  | CatalogCreatePayload
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
  installationId?: string;
  idempotencyKey: string;
  commandType: OfflineCommandType;
  payloadSchemaVersion?: number;
  payload: OfflineCommandPayload;
  dependsOnCommandIds?: string[];
};

export type ClaimedCommand = {
  command: OfflineCommandRecord;
  leaseToken: string;
  needsReceiptResolution: boolean;
};

export type ServerReceiptData = {
  receiptId?: string;
  entityId?: string;
  resultingVersion?: number;
  resultingOnHand?: number;
  resultingReserved?: number;
  serverTimestamp: string;
  rawResponse?: unknown;
};

function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalizeJson);
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) result[key] = canonicalizeJson(record[key]);
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
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
}
