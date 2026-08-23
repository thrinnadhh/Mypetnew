import { merchantApiFetch } from '../auth/session';

export type PaymentDeclarationMethod = 'CASH' | 'EXTERNAL_UPI' | 'CARD_TERMINAL';

export interface PosProductLine {
  listingId: string;
  name: string;
  barcode: string;
  sellingPricePaise: number;
  mrpPaise: number;
  availableStock: number;
  quantity: number;
}

export interface PosCustomerAssociation {
  challengeId: string;
  customerName: string;
  maskedMobile: string;
  loyaltyBalanceStars: number;
  availableRewards: number;
}

export interface PosSaleResult {
  saleId: string;
  totalPaise: number;
  loyaltyAwarded: boolean;
  receiptNumber: string;
  createdAt: string;
}

export interface PosCompleteSalePayload {
  outletId: string;
  associationChallengeId?: string | null;
  paymentDeclaration: {
    method: PaymentDeclarationMethod;
    referenceNotes?: string | null;
  };
  lines: Array<{ listingId: string; quantity: number }>;
}

export async function lookupBarcode(outletId: string, barcode: string): Promise<PosProductLine | null> {
  const normalized = barcode.trim();
  if (!normalized) return null;

  try {
    const response = await merchantApiFetch(
      `/api/v1/merchant/outlets/${outletId}/listings/barcode/${encodeURIComponent(normalized)}`,
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Barcode lookup failed: ${response.status}`);
    }
    const data = await response.json();
    return {
      listingId: data.id,
      name: data.name,
      barcode: data.barcode,
      sellingPricePaise: data.sellingPricePaise,
      mrpPaise: data.mrpPaise ?? data.sellingPricePaise,
      availableStock: data.availableStock ?? 10,
      quantity: 1,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) return null;
    throw error;
  }
}

export async function completePosSale(
  payload: PosCompleteSalePayload,
  idempotencyKey: string,
): Promise<PosSaleResult> {
  const response = await merchantApiFetch('/api/v1/merchant/pos/sales', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `POS sale completion failed: ${response.status}`);
  }

  return response.json();
}
