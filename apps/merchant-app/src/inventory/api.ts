import * as Crypto from 'expo-crypto';
import { merchantApiFetch } from '../auth/session';

export type InventoryAdjustmentReason =
  | 'MANUAL_INCREASE'
  | 'MANUAL_DECREASE'
  | 'RECEIVING'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'SHRINKAGE'
  | 'CUSTOMER_RETURN'
  | 'VENDOR_RETURN'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'COUNT_ADJUSTMENT';

export type InventoryBalance = {
  organizationId: string;
  outletId: string;
  listingId: string;
  onHand: number;
  reserved: number;
  version: number;
  updatedAt: string;
  available: number;
};

export type InventoryMovement = {
  id: string;
  organizationId?: string | null;
  outletId?: string | null;
  listingId: string;
  reason: string;
  quantityDelta: number;
  resultingOnHand: number;
  resultingReserved: number;
  sourceType?: string;
  sourceReference: string;
  actorId?: string;
  idempotencyKey?: string;
  occurredAt: string;
};

export type InventoryMovementPage = {
  items: InventoryMovement[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

export type InventoryAdjustmentInput = {
  outletId: string;
  listingId: string;
  quantityDelta: number;
  reason: InventoryAdjustmentReason;
  referenceType?: string | null;
  referenceId?: string | null;
};

export type InventoryReceivingInput = {
  outletId: string;
  listingId: string;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
};

export type InventoryDamageInput = {
  outletId: string;
  listingId: string;
  quantity: number;
  reasonDetails?: string | null;
  referenceId?: string | null;
};

export type InventoryExpiryInput = {
  outletId: string;
  listingId: string;
  quantity: number;
  batchReference?: string | null;
  expiryDate?: string | null;
};

export type InventoryShrinkageInput = {
  outletId: string;
  listingId: string;
  quantity: number;
  notes?: string | null;
  referenceId?: string | null;
};

export type InventoryReturnInput = {
  outletId: string;
  listingId: string;
  quantity: number;
  returnType: 'CUSTOMER_RETURN' | 'VENDOR_RETURN';
  referenceType?: string | null;
  referenceId?: string | null;
};

export type InventoryTransferInput = {
  sourceOutletId: string;
  destinationOutletId: string;
  sourceListingId: string;
  destinationListingId?: string | null;
  quantity: number;
};

export type CountLineInput = {
  listingId: string;
  countedQuantity: number;
};

export type InventoryCountLine = {
  listingId: string;
  countedQuantity: number;
  cutoffOnHand: number;
  reconciledDelta?: number | null;
  resultingOnHand?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryCountSession = {
  id: string;
  organizationId: string;
  outletId: string;
  status: 'OPEN' | 'SUBMITTED' | 'REVIEW_REQUIRED' | 'CANCELLED';
  cutoffSequenceNumber: number;
  cutoffTimestamp: string;
  actorId: string;
  submitIdempotencyKey?: string | null;
  reconciliationSummary?: string | null;
  lines: InventoryCountLine[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
};

export type CountReconciliationLineResult = {
  listingId: string;
  countedQuantity: number;
  cutoffOnHand: number;
  deltaAfterCutoff: number;
  targetCurrentOnHand: number;
  currentOnHandBeforeAdjustment: number;
  countAdjustmentDelta: number;
  resultingOnHand: number;
  movementId?: string | null;
};

export type CountReconciliationResult = {
  sessionId: string;
  status: string;
  lines: CountReconciliationLineResult[];
  submittedAt: string;
};

export type TransferResult = {
  transfer: {
    id: string;
    organizationId: string;
    sourceOutletId: string;
    destinationOutletId: string;
    sourceListingId: string;
    destinationListingId: string;
    quantity: number;
    status: string;
  };
  sourceMovement: InventoryMovement;
  destinationMovement: InventoryMovement;
};

export type InventoryAdjustmentCommand = Readonly<{
  idempotencyKey: string;
  input: InventoryAdjustmentInput;
}>;

type ApiErrorBody = { code?: string; message?: string; error?: string };

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const error = new Error(body?.message ?? body?.error ?? fallback);
  if (body?.code) error.name = body.code;
  return error;
}

function query(outletId: string, listingId: string, page?: number, pageSize?: number): string {
  const params = new URLSearchParams({ outletId, listingId });
  if (page !== undefined) params.set('page', String(page));
  if (pageSize !== undefined) params.set('pageSize', String(pageSize));
  return params.toString();
}

export function createInventoryAdjustmentCommand(input: InventoryAdjustmentInput): InventoryAdjustmentCommand {
  return Object.freeze({
    idempotencyKey: `inventory-adjust:${Crypto.randomUUID()}`,
    input: Object.freeze({ ...input }),
  });
}

export async function submitInventoryAdjustment(command: InventoryAdjustmentCommand): Promise<InventoryMovement> {
  const response = await merchantApiFetch('/api/v1/merchant/inventory/adjustments', {
    method: 'POST',
    headers: { 'Idempotency-Key': command.idempotencyKey },
    body: JSON.stringify(command.input),
  });
  if (!response.ok) throw await apiError(response, 'Could not update inventory.');
  return (await response.json()) as InventoryMovement;
}

export async function submitReceiving(input: InventoryReceivingInput, idempotencyKey?: string): Promise<StockMovementResponse> {
  const key = idempotencyKey ?? `inventory-receive:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch('/api/v1/merchant/inventory/receiving', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Could not record stock receiving.');
  return (await response.json()) as StockMovementResponse;
}

export async function submitDamage(input: InventoryDamageInput, idempotencyKey?: string): Promise<StockMovementResponse> {
  const key = idempotencyKey ?? `inventory-damage:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch('/api/v1/merchant/inventory/damage', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Could not record damaged stock.');
  return (await response.json()) as StockMovementResponse;
}

export async function submitExpiry(input: InventoryExpiryInput, idempotencyKey?: string): Promise<StockMovementResponse> {
  const key = idempotencyKey ?? `inventory-expiry:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch('/api/v1/merchant/inventory/expiry', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Could not record expired stock.');
  return (await response.json()) as StockMovementResponse;
}

export async function submitShrinkage(input: InventoryShrinkageInput, idempotencyKey?: string): Promise<StockMovementResponse> {
  const key = idempotencyKey ?? `inventory-shrinkage:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch('/api/v1/merchant/inventory/shrinkage', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Could not record shrinkage.');
  return (await response.json()) as StockMovementResponse;
}

export async function submitReturn(input: InventoryReturnInput, idempotencyKey?: string): Promise<StockMovementResponse> {
  const key = idempotencyKey ?? `inventory-return:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch('/api/v1/merchant/inventory/returns', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Could not record stock return.');
  return (await response.json()) as StockMovementResponse;
}

export async function submitTransfer(input: InventoryTransferInput, idempotencyKey?: string): Promise<TransferResult> {
  const key = idempotencyKey ?? `inventory-transfer:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch('/api/v1/merchant/inventory/transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Could not record outlet transfer.');
  return (await response.json()) as TransferResult;
}

export async function startStockCount(outletId: string): Promise<InventoryCountSession> {
  const response = await merchantApiFetch('/api/v1/merchant/inventory/counts', {
    method: 'POST',
    body: JSON.stringify({ outletId }),
  });
  if (!response.ok) throw await apiError(response, 'Could not start count session.');
  return (await response.json()) as InventoryCountSession;
}

export async function fetchStockCount(outletId: string, sessionId: string): Promise<InventoryCountSession> {
  const response = await merchantApiFetch(`/api/v1/merchant/inventory/counts/${encodeURIComponent(sessionId)}?outletId=${encodeURIComponent(outletId)}`);
  if (!response.ok) throw await apiError(response, 'Could not load count session.');
  return (await response.json()) as InventoryCountSession;
}

export async function updateStockCountLines(
  outletId: string,
  sessionId: string,
  lines: CountLineInput[],
): Promise<InventoryCountSession> {
  const response = await merchantApiFetch(`/api/v1/merchant/inventory/counts/${encodeURIComponent(sessionId)}/lines`, {
    method: 'PUT',
    body: JSON.stringify({ outletId, lines }),
  });
  if (!response.ok) throw await apiError(response, 'Could not update count lines.');
  return (await response.json()) as InventoryCountSession;
}

export async function submitStockCount(
  outletId: string,
  sessionId: string,
  idempotencyKey?: string,
): Promise<CountReconciliationResult> {
  const key = idempotencyKey ?? `inventory-count:${sessionId}:${Crypto.randomUUID()}`;
  const response = await merchantApiFetch(`/api/v1/merchant/inventory/counts/${encodeURIComponent(sessionId)}/submit`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ outletId }),
  });
  if (!response.ok) throw await apiError(response, 'Could not submit stock count.');
  return (await response.json()) as CountReconciliationResult;
}

export type StockMovementResponse = InventoryMovement;

export async function fetchInventoryBalance(outletId: string, listingId: string): Promise<InventoryBalance> {
  const response = await merchantApiFetch(`/api/v1/merchant/inventory/balance?${query(outletId, listingId)}`);
  if (!response.ok) throw await apiError(response, 'Could not load inventory balance.');
  return (await response.json()) as InventoryBalance;
}

export async function fetchInventoryMovements(
  outletId: string,
  listingId: string,
  page = 0,
  pageSize = 25,
): Promise<InventoryMovementPage> {
  const response = await merchantApiFetch(
    `/api/v1/merchant/inventory/movements?${query(outletId, listingId, page, pageSize)}`,
  );
  if (!response.ok) throw await apiError(response, 'Could not load stock ledger history.');
  return (await response.json()) as InventoryMovementPage;
}
