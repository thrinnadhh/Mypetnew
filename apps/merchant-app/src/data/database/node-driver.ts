import type { Database as BetterSqliteDb } from 'better-sqlite3';
import type { SqliteDatabase, SqliteRunResult, SqliteTransaction } from './driver';

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
    let retries = 100;
    while (retries > 0) {
      try {
        this.db.exec(sql);
        return;
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !(err instanceof Error && (err.message.includes('locked') || err.message.includes('busy')))) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: result.lastInsertRowid,
    };
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params);
    return (row as T) ?? null;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return (rows as T[]) ?? [];
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

    let retries = 50;
    while (retries > 0) {
      try {
        await this.exec('BEGIN IMMEDIATE');
        break;
      } catch (err: unknown) {
        retries -= 1;
        if (retries === 0 || !(err instanceof Error && (err.message.includes('locked') || err.message.includes('busy')))) {
          releaseLock();
          throw err;
        }
        await new Promise((r) => setTimeout(r, 10));
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
  const db: BetterSqliteDb = new Database(filename, { timeout: 2000 });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 2000');
  db.pragma('foreign_keys = ON');
  return new NodeSqliteDriver(db);
}
