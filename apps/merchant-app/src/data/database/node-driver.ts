import type { Database as BetterSqliteDb } from 'better-sqlite3';
import type { SqliteDatabase, SqliteRunResult, SqliteTransaction } from './driver';

export class NodeSqliteDriver implements SqliteDatabase {
  private db: BetterSqliteDb;
  private open = true;

  constructor(dbInstance: BetterSqliteDb) {
    this.db = dbInstance;
  }

  isOpen(): boolean {
    return this.open && this.db.open;
  }

  async exec(sql: string): Promise<void> {
    if (!this.isOpen()) throw new Error('DATABASE_CLOSED');
    this.db.exec(sql);
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
      this.db.close();
    }
  }
}

export function createNodeSqliteDatabase(filename = ':memory:'): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db: BetterSqliteDb = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return new NodeSqliteDriver(db);
}
