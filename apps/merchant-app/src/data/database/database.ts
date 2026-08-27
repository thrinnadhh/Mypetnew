import { DatabaseBootstrapper, type DatabaseBootstrapState } from './bootstrap';
import type { SqliteDatabase, SqliteRunResult, SqliteTransaction } from './driver';
import { createNodeSqliteDatabase } from './node-driver';
import { DatabaseRecoveryManager } from './recovery';

export class MerchantDatabase implements SqliteDatabase {
  private readonly db: SqliteDatabase;
  private readonly bootstrapper: DatabaseBootstrapper;

  constructor(db: SqliteDatabase, bootstrapper?: DatabaseBootstrapper) {
    this.db = db;
    this.bootstrapper = bootstrapper ?? new DatabaseBootstrapper();
  }

  async initialize(): Promise<DatabaseBootstrapState> {
    return this.bootstrapper.bootstrap(this.db);
  }

  isReady(): boolean {
    return this.bootstrapper.isReady();
  }

  isOpen(): boolean {
    return this.db.isOpen();
  }

  getRecoveryManager(): DatabaseRecoveryManager {
    return this.bootstrapper.getRecoveryManager();
  }

  getUnderlyingDriver(): SqliteDatabase {
    return this.db;
  }

  async exec(sql: string): Promise<void> {
    return this.db.exec(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<SqliteRunResult> {
    return this.db.run(sql, params);
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return this.db.get<T>(sql, params);
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.all<T>(sql, params);
  }

  async transaction<T>(action: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(action);
  }

  async close(): Promise<void> {
    this.bootstrapper.reset();
    return this.db.close();
  }
}

export function createMerchantDatabase(options: {
  db?: SqliteDatabase;
  filename?: string;
  bootstrapper?: DatabaseBootstrapper;
} = {}): MerchantDatabase {
  const driver = options.db ?? createNodeSqliteDatabase(options.filename ?? ':memory:');
  return new MerchantDatabase(driver, options.bootstrapper);
}
