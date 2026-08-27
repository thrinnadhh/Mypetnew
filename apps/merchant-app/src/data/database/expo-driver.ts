import type { SqliteDatabase, SqliteRunResult, SqliteTransaction } from './driver';

export type NativeExpoTransaction = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
};

export type NativeExpoSqliteInstance = NativeExpoTransaction & {
  withExclusiveTransactionAsync?(task: (txn: NativeExpoTransaction) => Promise<void>): Promise<void>;
  withTransactionAsync?(task: () => Promise<void>): Promise<void>;
  closeAsync?(): Promise<void>;
};

function createScopedTransaction(nativeTx: NativeExpoTransaction): SqliteTransaction {
  return {
    async exec(sql: string): Promise<void> {
      await nativeTx.execAsync(sql);
    },
    async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
      const result = await nativeTx.runAsync(sql, ...params);
      return {
        changes: Number(result.changes),
        lastInsertRowId: result.lastInsertRowId,
      };
    },
    async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
      const row = await nativeTx.getFirstAsync<T>(sql, ...params);
      return row ?? null;
    },
    async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows = await nativeTx.getAllAsync<T>(sql, ...params);
      return rows ?? [];
    },
  };
}

export class ExpoSqliteDriver implements SqliteDatabase {
  private readonly db: NativeExpoSqliteInstance;
  private open = true;
  private operationGate: Promise<unknown> = Promise.resolve();

  constructor(dbInstance: NativeExpoSqliteInstance) {
    this.db = dbInstance;
  }

  isOpen(): boolean {
    return this.open;
  }

  private async withGate<T>(op: () => Promise<T>): Promise<T> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');

    const previousLock = this.operationGate;
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.operationGate = previousLock.then(() => currentLock, () => currentLock);

    await previousLock;
    if (!this.isOpen()) {
      releaseLock();
      throw new Error('DATABASE_CLOSED');
    }

    try {
      return await op();
    } finally {
      releaseLock();
    }
  }

  async exec(sql: string): Promise<void> {
    return this.withGate(async () => {
      await this.db.execAsync(sql);
    });
  }

  async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
    return this.withGate(async () => {
      const result = await this.db.runAsync(sql, ...params);
      return {
        changes: Number(result.changes),
        lastInsertRowId: result.lastInsertRowId,
      };
    });
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return this.withGate(async () => {
      const row = await this.db.getFirstAsync<T>(sql, ...params);
      return row ?? null;
    });
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.withGate(async () => {
      const rows = await this.db.getAllAsync<T>(sql, ...params);
      return rows ?? [];
    });
  }

  async transaction<T>(action: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    return this.withGate(async () => {
      if (typeof this.db.withExclusiveTransactionAsync === 'function') {
        let result!: T;
        await this.db.withExclusiveTransactionAsync(async (nativeTx) => {
          const scopedTx = createScopedTransaction(nativeTx ?? this.db);
          result = await action(scopedTx);
        });
        return result;
      }

      if (typeof this.db.withTransactionAsync === 'function') {
        let result!: T;
        await this.db.withTransactionAsync(async () => {
          const scopedTx = createScopedTransaction(this.db);
          result = await action(scopedTx);
        });
        return result;
      }

      // Manual serialization fallback
      await this.db.execAsync('BEGIN IMMEDIATE;');
      try {
        const scopedTx = createScopedTransaction(this.db);
        const result = await action(scopedTx);
        await this.db.execAsync('COMMIT;');
        return result;
      } catch (error) {
        try {
          await this.db.execAsync('ROLLBACK;');
        } catch {
          // Ignore rollback error
        }
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    if (!this.open) return;
    this.open = false;
    if (this.db && typeof this.db.closeAsync === 'function') {
      await this.db.closeAsync();
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
