import { DatabaseBootstrapper } from '../bootstrap';
import { getSchemaVersion, runMigrations, setSchemaVersion } from '../migrations';
import { createNodeSqliteDatabase } from '../node-driver';
import {
  CURRENT_SCHEMA_VERSION,
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_DRAFTS,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_INVENTORY_COUNT_DRAFTS,
  TABLE_INVENTORY_COUNT_DRAFT_LINES,
  TABLE_OFFLINE_COMMANDS,
  TABLE_OFFLINE_COMMAND_DEPENDENCIES,
  TABLE_PENDING_MEDIA,
  TABLE_PROJECTION_SYNC_STATE,
  TABLE_PROJECTION_TOMBSTONES,
} from '../schema';

describe('M8 SQLite Bootstrap and Migrations', () => {
  it('performs clean bootstrap to schema version 6 and creates M8 count draft tables', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();

    const result = await bootstrapper.bootstrap(db);
    expect(result.isInitialized).toBe(true);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.schemaVersion).toBe(6);

    const version = await getSchemaVersion(db);
    expect(version).toBe(6);

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
    expect(tableNames).toContain(TABLE_CATALOG_DRAFTS);
    expect(tableNames).toContain(TABLE_PENDING_MEDIA);
    expect(tableNames).toContain(TABLE_INVENTORY_COUNT_DRAFTS);
    expect(tableNames).toContain(TABLE_INVENTORY_COUNT_DRAFT_LINES);

    await db.close();
  });

  it('runs migration chain forward through 6 and remains idempotent at 6', async () => {
    const db = createNodeSqliteDatabase(':memory:');

    for (let target = 1; target <= 6; target += 1) {
      const result = await runMigrations(db, target);
      expect(result.currentVersion).toBe(target);
      expect(result.appliedVersions).toEqual([target]);
    }

    const idempotent = await runMigrations(db, 6);
    expect(idempotent.currentVersion).toBe(6);
    expect(idempotent.appliedVersions).toEqual([]);

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
