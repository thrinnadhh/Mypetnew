import type { SqliteDatabase } from './driver';
import { runMigrations, setSchemaVersion } from './migrations';
import {
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_SYNC_STATE,
  TABLE_PROJECTION_TOMBSTONES,
} from './schema';

export type DatabaseRecoveryDiagnostic = {
  timestamp: string;
  errorName: string;
  errorMessage: string;
  recovered: boolean;
};

export class DatabaseRecoveryManager {
  private recoveryCount = 0;
  private lastDiagnostic: DatabaseRecoveryDiagnostic | null = null;

  getLastDiagnostic(): DatabaseRecoveryDiagnostic | null {
    return this.lastDiagnostic;
  }

  getRecoveryCount(): number {
    return this.recoveryCount;
  }

  isRecoverableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    // Incompatible newer database schema must FAIL CLOSED and NEVER trigger destructive recovery
    if (msg.includes('database_incompatible_version')) {
      return false;
    }
    return (
      msg.includes('sqlite_corrupt') ||
      msg.includes('corrupt') ||
      msg.includes('malformed') ||
      msg.includes('database disk image is malformed') ||
      msg.includes('migration_verification_failed') ||
      msg.includes('schema_verification_failed')
    );
  }

  async recoverProjectionDatabase(db: SqliteDatabase, originalError: Error): Promise<void> {
    if (this.recoveryCount >= 1) {
      throw new Error(
        `DATABASE_RECOVERY_ABORTED: Maximum recovery attempts exceeded to prevent infinite loops. Cause: ${originalError.message}`,
      );
    }

    this.recoveryCount += 1;

    try {
      // Clean slate table drop for projection cache tables
      await db.exec(`DROP TABLE IF EXISTS ${TABLE_PROJECTION_TOMBSTONES};`);
      await db.exec(`DROP TABLE IF EXISTS ${TABLE_CATALOG_BARCODES};`);
      await db.exec(`DROP TABLE IF EXISTS ${TABLE_CATALOG_ITEMS};`);
      await db.exec(`DROP TABLE IF EXISTS ${TABLE_INVENTORY_BALANCES};`);
      await db.exec(`DROP TABLE IF EXISTS ${TABLE_PROJECTION_SYNC_STATE};`);

      // Reset schema version to 0
      await setSchemaVersion(db, 0);

      // Re-run fresh migrations
      await runMigrations(db);

      this.lastDiagnostic = {
        timestamp: new Date().toISOString(),
        errorName: originalError.name || 'DatabaseError',
        errorMessage: originalError.message,
        recovered: true,
      };
    } catch (recoveryError) {
      this.lastDiagnostic = {
        timestamp: new Date().toISOString(),
        errorName: originalError.name || 'DatabaseError',
        errorMessage: originalError.message,
        recovered: false,
      };
      throw new Error(
        `DATABASE_RECOVERY_FAILED: Could not recover projection database. Original: ${originalError.message}. Recovery error: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
      );
    }
  }

  resetRecoveryCount(): void {
    this.recoveryCount = 0;
  }
}
