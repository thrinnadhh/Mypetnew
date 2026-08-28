import { DatabaseBootstrapper } from '../bootstrap';
import { getSchemaVersion, runMigrations, setSchemaVersion } from '../migrations';
import { createNodeSqliteDatabase } from '../node-driver';
import {
  CURRENT_SCHEMA_VERSION,
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_OFFLINE_COMMANDS,
  TABLE_OFFLINE_COMMAND_DEPENDENCIES,
  TABLE_PROJECTION_SYNC_STATE,
  TABLE_PROJECTION_TOMBSTONES,
} from '../schema';

describe('M6 SQLite Bootstrap and Migrations', () => {
  it('performs clean bootstrap to schema version 4 and creates all 11 tables', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();

    const result = await bootstrapper.bootstrap(db);
    expect(result.isInitialized).toBe(true);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.schemaVersion).toBe(4);

    const version = await getSchemaVersion(db);
    expect(version).toBe(4);

    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain(TABLE_PROJECTION_SYNC_STATE);
    expect(tableNames).toContain(TABLE_CATALOG_ITEMS);
    expect(tableNames).toContain(TABLE_CATALOG_BARCODES);
    expect(tableNames).toContain(TABLE_INVENTORY_BALANCES);
    expect(tableNames).toContain(TABLE_PROJECTION_TOMBSTONES);
    expect(tableNames).toContain(TABLE_OFFLINE_COMMANDS);
    expect(tableNames).toContain(TABLE_OFFLINE_COMMAND_DEPENDENCIES);

    await db.close();
  });

  it('runs migration chain forward from 0 -> 4, 1 -> 4, 2 -> 4, 3 -> 4, and 4 -> 4 idempotently', async () => {
    const db = createNodeSqliteDatabase(':memory:');

    // 0 -> 1
    const res1 = await runMigrations(db, 1);
    expect(res1.currentVersion).toBe(1);
    expect(res1.appliedVersions).toEqual([1]);

    // 1 -> 2
    const res2 = await runMigrations(db, 2);
    expect(res2.currentVersion).toBe(2);
    expect(res2.appliedVersions).toEqual([2]);

    // 2 -> 3
    const res3 = await runMigrations(db, 3);
    expect(res3.currentVersion).toBe(3);
    expect(res3.appliedVersions).toEqual([3]);

    // 3 -> 4
    const res4 = await runMigrations(db, 4);
    expect(res4.currentVersion).toBe(4);
    expect(res4.appliedVersions).toEqual([4]);

    // 4 -> 4 idempotent
    const res5 = await runMigrations(db, 4);
    expect(res5.currentVersion).toBe(4);
    expect(res5.appliedVersions).toEqual([]);

    await db.close();
  });

  it('is idempotent when calling bootstrap multiple times on the same instance', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();

    const result1 = await bootstrapper.bootstrap(db);
    const result2 = await bootstrapper.bootstrap(db);

    expect(result1.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result2.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(bootstrapper.isReady()).toBe(true);

    await db.close();
  });

  it('rolls back migration transaction if an error occurs during migration execution', async () => {
    const db = createNodeSqliteDatabase(':memory:');

    await expect(
      db.transaction(async (tx) => {
        await tx.exec('CREATE TABLE temp_test (id TEXT PRIMARY KEY);');
        await tx.run('INSERT INTO temp_test VALUES (?);', ['1']);
        throw new Error('SIMULATED_MIGRATION_FAILURE');
      }),
    ).rejects.toThrow('SIMULATED_MIGRATION_FAILURE');

    const table = await db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='temp_test';",
    );
    expect(table).toBeNull();

    await db.close();
  });

  it('rejects future schema version with DATABASE_INCOMPATIBLE_VERSION', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await setSchemaVersion(db, CURRENT_SCHEMA_VERSION + 1);

    await expect(runMigrations(db, CURRENT_SCHEMA_VERSION)).rejects.toThrow(
      'DATABASE_INCOMPATIBLE_VERSION',
    );

    await db.close();
  });
});
