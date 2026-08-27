export type SqliteRunResult = {
  changes: number;
  lastInsertRowId: number | bigint;
};

export interface SqliteTransaction {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<SqliteRunResult>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface SqliteDatabase extends SqliteTransaction {
  transaction<T>(action: (tx: SqliteTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isOpen(): boolean;
}
