import type { SqliteDatabase, SqliteTransaction } from './driver';
import {
  CURRENT_SCHEMA_VERSION,
  V1_SCHEMA_STATEMENTS,
  V2_SCHEMA_STATEMENTS,
  V3_SCHEMA_STATEMENTS,
  V4_SCHEMA_STATEMENTS,
  V5_SCHEMA_STATEMENTS,
  V6_SCHEMA_STATEMENTS,
} from './schema';

export type Migration = {
  version: number;
  description: string;
  up: (db: SqliteDatabase | SqliteTransaction) => Promise<void>;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: projection_sync_state, catalog_items, catalog_barcodes, inventory_balances',
    up: async (db: SqliteDatabase | SqliteTransaction) => {
      for (const statement of V1_SCHEMA_STATEMENTS) await db.exec(statement);
    },
  },
  {
    version: 2,
    description: 'Add partitioned durable tombstone ledger: projection_tombstones',
    up: async (db: SqliteDatabase | SqliteTransaction) => {
      for (const statement of V2_SCHEMA_STATEMENTS) await db.exec(statement);
    },
  },
  {
    version: 3,
    description: 'Add durable offline command outbox and dependency ledger: offline_commands, offline_command_dependencies',
    up: async (db: SqliteDatabase | SqliteTransaction) => {
      for (const statement of V3_SCHEMA_STATEMENTS) await db.exec(statement);
    },
  },
  {
    version: 4,
    description: 'Add durable bounded bootstrap staging tables: bootstrap_staging_items, bootstrap_staging_balances, bootstrap_staging_barcodes, bootstrap_staging_state',
    up: async (db: SqliteDatabase | SqliteTransaction) => {
      for (const statement of V4_SCHEMA_STATEMENTS) await db.exec(statement);
    },
  },
  {
    version: 5,
    description: 'Add partitioned offline catalog drafts and pending media reconciliation',
    up: async (db: SqliteDatabase | SqliteTransaction) => {
      for (const statement of V5_SCHEMA_STATEMENTS) await db.exec(statement);
    },
  },
  {
    version: 6,
    description: 'Add partitioned offline inventory count draft sessions and count lines',
    up: async (db: SqliteDatabase | SqliteTransaction) => {
      for (const statement of V6_SCHEMA_STATEMENTS) await db.exec(statement);
    },
  },
];

export async function getSchemaVersion(db: SqliteDatabase): Promise<number> {
  const result = await db.get<{ user_version: number }>('PRAGMA user_version;');
  if (!result || typeof result.user_version !== 'number') return 0;
  return result.user_version;
}

export async function setSchemaVersion(db: SqliteDatabase, version: number): Promise<void> {
  await db.exec(`PRAGMA user_version = ${Math.floor(version)};`);
}

export type MigrationResult = {
  previousVersion: number;
  currentVersion: number;
  appliedVersions: number[];
};

export async function runMigrations(
  db: SqliteDatabase,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): Promise<MigrationResult> {
  const currentVersion = await getSchemaVersion(db);
  if (currentVersion > targetVersion) {
    throw new Error(`DATABASE_INCOMPATIBLE_VERSION: Database version (${currentVersion}) is newer than application target (${targetVersion})`);
  }
  if (currentVersion === targetVersion) {
    return { previousVersion: currentVersion, currentVersion, appliedVersions: [] };
  }

  const pendingMigrations = MIGRATIONS.filter(
    (m) => m.version > currentVersion && m.version <= targetVersion,
  ).sort((a, b) => a.version - b.version);
  const applied: number[] = [];

  for (const migration of pendingMigrations) {
    await db.transaction(async (tx) => {
      await migration.up(tx);
      await tx.exec(`PRAGMA user_version = ${migration.version};`);
    });
    applied.push(migration.version);
  }

  const finalVersion = await getSchemaVersion(db);
  if (finalVersion !== targetVersion) {
    throw new Error(`MIGRATION_VERIFICATION_FAILED: Expected schema version ${targetVersion}, but found ${finalVersion}`);
  }

  return { previousVersion: currentVersion, currentVersion: finalVersion, appliedVersions: applied };
}
