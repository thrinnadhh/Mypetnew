import type { SqliteDatabase } from './driver';
import { runMigrations } from './migrations';
import { DatabaseRecoveryManager } from './recovery';
import {
  CURRENT_SCHEMA_VERSION,
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_SYNC_STATE,
} from './schema';

export type DatabaseBootstrapOptions = {
  allowRecovery?: boolean;
  recoveryManager?: DatabaseRecoveryManager;
};

export type DatabaseBootstrapState = {
  isInitialized: boolean;
  schemaVersion: number;
  tables: string[];
};

export class DatabaseBootstrapper {
  private initialized = false;
  private inFlightBootstrap: Promise<DatabaseBootstrapState> | null = null;
  private readonly recoveryManager: DatabaseRecoveryManager;

  constructor(recoveryManager?: DatabaseRecoveryManager) {
    this.recoveryManager = recoveryManager ?? new DatabaseRecoveryManager();
  }

  getRecoveryManager(): DatabaseRecoveryManager {
    return this.recoveryManager;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async bootstrap(
    db: SqliteDatabase,
    options: DatabaseBootstrapOptions = {},
  ): Promise<DatabaseBootstrapState> {
    if (this.initialized) {
      const version = await this.verifySchema(db);
      return {
        isInitialized: true,
        schemaVersion: version,
        tables: [
          TABLE_PROJECTION_SYNC_STATE,
          TABLE_CATALOG_ITEMS,
          TABLE_CATALOG_BARCODES,
          TABLE_INVENTORY_BALANCES,
        ],
      };
    }

    if (this.inFlightBootstrap) {
      return this.inFlightBootstrap;
    }

    const promise = (async () => {
      try {
        const result = await this.executeBootstrap(db);
        this.initialized = true;
        return result;
      } catch (error) {
        const allowRecovery = options.allowRecovery ?? true;
        const err = error instanceof Error ? error : new Error(String(error));

        if (allowRecovery && this.recoveryManager.isRecoverableError(err)) {
          await this.recoveryManager.recoverProjectionDatabase(db, err);
          const result = await this.executeBootstrap(db);
          this.initialized = true;
          return result;
        }

        throw err;
      } finally {
        this.inFlightBootstrap = null;
      }
    })();

    this.inFlightBootstrap = promise;
    return promise;
  }

  private async executeBootstrap(db: SqliteDatabase): Promise<DatabaseBootstrapState> {
    await runMigrations(db, CURRENT_SCHEMA_VERSION);
    const version = await this.verifySchema(db);
    return {
      isInitialized: true,
      schemaVersion: version,
      tables: [
        TABLE_PROJECTION_SYNC_STATE,
        TABLE_CATALOG_ITEMS,
        TABLE_CATALOG_BARCODES,
        TABLE_INVENTORY_BALANCES,
      ],
    };
  }

  private async verifySchema(db: SqliteDatabase): Promise<number> {
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    );
    const tableNames = new Set(tables.map((t) => t.name));

    const required = [
      TABLE_PROJECTION_SYNC_STATE,
      TABLE_CATALOG_ITEMS,
      TABLE_CATALOG_BARCODES,
      TABLE_INVENTORY_BALANCES,
    ];

    for (const req of required) {
      if (!tableNames.has(req)) {
        throw new Error(`SCHEMA_VERIFICATION_FAILED: Required table ${req} is missing`);
      }
    }

    const versionResult = await db.get<{ user_version: number }>('PRAGMA user_version;');
    return versionResult?.user_version ?? 0;
  }

  reset(): void {
    this.initialized = false;
    this.inFlightBootstrap = null;
    this.recoveryManager.resetRecoveryCount();
  }
}
