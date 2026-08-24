import * as Crypto from 'expo-crypto';
import { merchantApiFetch } from '../auth/session';

export type InventoryAdjustmentReason = 'MANUAL_INCREASE' | 'MANUAL_DECREASE';

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
  if (!response.ok) throw await apiError(response, 'Could not load inventory history.');
  return (await response.json()) as InventoryMovementPage;
}
