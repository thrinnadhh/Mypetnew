import { merchantApiFetch } from '../auth/session';
import type { BarcodeType, MerchantListing } from '../catalog/api';
import { normalizeMerchantBarcode } from './model';
import type { PaymentDeclaration } from './pos-cart';

export type BarcodeResolution = {
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  listing: MerchantListing | null;
};

export type PosSaleLineResponse = {
  first: number; // quantity
  second: number; // unitPricePaise
};

export type PosSaleResponse = {
  id: string;
  merchantId: string;
  outletId: string;
  customerId: string | null;
  lines: Record<string, PosSaleLineResponse>;
  totalPaise: number;
  paymentDeclaration: PaymentDeclaration;
  completedAt: string;
  loyaltyAwarded: boolean;
  cashierId?: string;
  traceId?: string;
};

export type PosSaleRequestPayload = {
  outletId: string;
  associationChallengeId?: string | null;
  paymentDeclaration: PaymentDeclaration;
  lines: Array<{ listingId: string; quantity: number }>;
};

type ApiErrorBody = { code?: string; message?: string; error?: string };

async function apiError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const error = new Error(body?.message ?? body?.error ?? 'Request failed.');
  if (body?.code) error.name = body.code;
  return error;
}

export async function resolveMerchantBarcode(
  outletId: string,
  barcodeType: BarcodeType,
  rawBarcode: string,
): Promise<BarcodeResolution> {
  const barcode = normalizeMerchantBarcode(barcodeType, rawBarcode);
  const params = new URLSearchParams({ outletId, barcodeType, barcode });
  const response = await merchantApiFetch(`/api/v1/merchant/barcodes/resolve?${params.toString()}`);
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as BarcodeResolution;
}

export async function completePosSale(
  request: PosSaleRequestPayload,
  idempotencyKey: string,
): Promise<PosSaleResponse> {
  const response = await merchantApiFetch('/api/v1/merchant/pos/sales', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as PosSaleResponse;
}

export async function getPosSale(saleId: string): Promise<PosSaleResponse> {
  const response = await merchantApiFetch(`/api/v1/merchant/pos/sales/${saleId}`);
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as PosSaleResponse;
}

export async function findPosSaleByIdempotencyKey(
  outletId: string,
  idempotencyKey: string,
): Promise<PosSaleResponse> {
  const params = new URLSearchParams({ outletId, idempotencyKey });
  const response = await merchantApiFetch(`/api/v1/merchant/pos/sales/by-key?${params.toString()}`);
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as PosSaleResponse;
}
