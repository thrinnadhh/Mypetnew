import type { SqliteDatabase, SqliteRunResult, SqliteTransaction } from './driver';

export type NativeExpoSqliteInstance = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  withTransactionAsync?<T>(task: () => Promise<T>): Promise<T>;
  closeAsync?(): Promise<void>;
};

export class ExpoSqliteDriver implements SqliteDatabase {
  private readonly db: NativeExpoSqliteInstance;
  private open = true;

  constructor(dbInstance: NativeExpoSqliteInstance) {
    this.db = dbInstance;
  }

  isOpen(): boolean {
    return this.open;
  }

  async exec(sql: string): Promise<void> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    const result = await this.db.runAsync(sql, ...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: result.lastInsertRowId,
    };
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    const row = await this.db.getFirstAsync<T>(sql, ...params);
    return row ?? null;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    const rows = await this.db.getAllAsync<T>(sql, ...params);
    return rows ?? [];
  }

  async transaction<T>(action: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    if (typeof this.db.withTransactionAsync === 'function') {
      return this.db.withTransactionAsync(() => action(this));
    }
    await this.exec('BEGIN IMMEDIATE');
    try {
      const result = await action(this);
      await this.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        await this.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors if transaction already failed
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.open && this.db) {
      this.open = false;
      if (typeof this.db.closeAsync === 'function') {
        await this.db.closeAsync();
      }
    }
  }
}

export async function createExpoSqliteDatabase(dbName = 'mypetnew_merchant.db'): Promise<SqliteDatabase> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(dbName);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  return new ExpoSqliteDriver(db as unknown as NativeExpoSqliteInstance);
}
