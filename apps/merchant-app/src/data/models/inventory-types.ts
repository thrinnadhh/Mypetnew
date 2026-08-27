import type { InventoryBalance } from '../../inventory/api';

export type LocalInventoryBalance = {
  accountId: string;
  organizationId: string;
  outletId: string;
  listingId: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  serverUpdatedAt: string;
  localUpdatedAt: string;
  isTombstone: boolean;
  tombstonedAt: string | null;
};

export type InventoryProjectionBatch = {
  balances: InventoryBalance[];
  tombstones?: Array<{ listingId: string; updatedAt: string }>;
  cursor?: string | null;
};
