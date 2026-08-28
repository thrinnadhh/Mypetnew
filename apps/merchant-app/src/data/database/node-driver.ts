import type { Database as BetterSqliteDb } from 'better-sqlite3';
import type { SqliteDatabase, SqliteRunResult, SqliteTransaction } from './driver';

function isSqliteBusyError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    /locked|busy/i.test(msg)
  );
}

export class NodeSqliteDriver implements SqliteDatabase {
  private db: BetterSqliteDb;
  private open = true;
  private txLock: Promise<void> = Promise.resolve();

  constructor(dbInstance: BetterSqliteDb) {
    this.db = dbInstance;
  }

  isOpen(): boolean {
    return this.open && this.db.open;
  }

  async exec(sql: string): Promise<void> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    let retries = 500;
    while (retries > 0) {
      try {
        this.db.exec(sql);
        return;
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !isSqliteBusyError(err)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
      }
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    let retries = 500;
    while (retries > 0) {
      try {
        const stmt = this.db.prepare(sql);
        const result = stmt.run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowId: result.lastInsertRowid,
        };
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !isSqliteBusyError(err)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
      }
    }
    throw new Error('SQLITE_BUSY_TIMEOUT');
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    let retries = 500;
    while (retries > 0) {
      try {
        const stmt = this.db.prepare(sql);
        const row = stmt.get(...params);
        return (row as T) ?? null;
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !isSqliteBusyError(err)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
      }
    }
    throw new Error('SQLITE_BUSY_TIMEOUT');
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    let retries = 500;
    while (retries > 0) {
      try {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params);
        return (rows as T[]) ?? [];
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !isSqliteBusyError(err)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
      }
    }
    throw new Error('SQLITE_BUSY_TIMEOUT');
  }

  async transaction<T>(action: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');

    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const previousLock = this.txLock;
    this.txLock = this.txLock.then(() => lockPromise);

    await previousLock;

    let retries = 500;
    while (retries > 0) {
      try {
        this.db.exec('BEGIN IMMEDIATE');
        break;
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !isSqliteBusyError(err)) {
          releaseLock();
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
      }
    }

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
    } finally {
      releaseLock();
    }
  }

  async close(): Promise<void> {
    if (this.open && this.db) {
      this.open = false;
      this.db.close();
    }
  }
}

export function createNodeSqliteDatabase(filename = ':memory:'): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db: BetterSqliteDb = new Database(filename, { timeout: 0 });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 0');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return new NodeSqliteDriver(db);
}
