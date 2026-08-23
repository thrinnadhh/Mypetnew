import { merchantApiFetch } from '../auth/session';

export interface MerchantListingItem {
  id: string;
  name: string;
  category: string;
  brand?: string | null;
  barcode: string;
  sku?: string | null;
  mrpPaise: number;
  sellingPricePaise: number;
  availableQuantity: number;
  isMedicineViewOnly?: boolean;
}

export interface InventoryMovementResult {
  movementId: string;
  listingId: string;
  quantityChanged: number;
  resultingQuantity: number;
}

export async function fetchMerchantListings(outletId: string): Promise<MerchantListingItem[]> {
  const response = await merchantApiFetch(`/api/v1/merchant/outlets/${outletId}/listings`);
  if (!response.ok) {
    throw new Error(`Could not load inventory: ${response.status}`);
  }
  const data = await response.json();
  const items = Array.isArray(data) ? data : data.items ?? [];
  return items.map((item: any) => ({
    id: item.id,
    name: item.name,
    category: item.category ?? 'General',
    brand: item.brand,
    barcode: item.barcode,
    sku: item.sku,
    mrpPaise: item.mrpPaise ?? item.sellingPricePaise,
    sellingPricePaise: item.sellingPricePaise,
    availableQuantity: item.availableQuantity ?? 0,
    isMedicineViewOnly: item.category?.toLowerCase().includes('medicine') || item.kind === 'MEDICINE_VIEW_ONLY',
  }));
}

export async function receiveStock(
  outletId: string,
  listingId: string,
  quantity: number,
  idempotencyKey: string,
): Promise<InventoryMovementResult> {
  const response = await merchantApiFetch('/api/v1/merchant/inventory/receive', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      outletId,
      listingId,
      quantity,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `Stock receipt failed: ${response.status}`);
  }

  return response.json();
}
