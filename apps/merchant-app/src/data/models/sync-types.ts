export type ProjectionName = 'CATALOG' | 'INVENTORY' | 'BARCODE' | string;

export type ProjectionFreshness = 'never-synced' | 'fresh' | 'stale' | 'sync-failed';

export type SyncDbStatus = 'NEVER_SYNCED' | 'FRESH' | 'STALE' | 'SYNC_FAILED';

export type SyncStateRecord = {
  accountId: string;
  organizationId: string;
  outletId: string;
  projectionName: ProjectionName;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  status: SyncDbStatus;
  cursor: string | null;
  lastError: string | null;
};

export type TombstoneRecord = {
  accountId: string;
  organizationId: string;
  outletId: string;
  projectionName: ProjectionName;
  entityId: string;
  serverUpdatedAt: string;
  serverVersion: number | null;
  deletedAt: string;
};

export type FreshnessOptions = {
  maxAgeMs?: number;
  nowMs?: number;
};

export const DEFAULT_PROJECTION_TTL_MS = 15 * 60 * 1000; // 15 minutes
