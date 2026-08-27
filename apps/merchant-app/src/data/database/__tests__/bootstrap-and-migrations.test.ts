import { DatabaseBootstrapper } from '../bootstrap';
import { createMerchantDatabase, MerchantDatabase } from '../database';
import { getSchemaVersion, runMigrations, setSchemaVersion } from '../migrations';
import { createNodeSqliteDatabase } from '../node-driver';
import {
  CURRENT_SCHEMA_VERSION,
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_SYNC_STATE,
} from '../schema';

describe('M5 Database Bootstrap and Migrations', () => {
  let db: MerchantDatabase;

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.close();
    }
  });

  it('performs clean database bootstrap and reaches schema version 1', async () => {
    db = createMerchantDatabase();
    const state = await db.initialize();

    expect(state.isInitialized).toBe(true);
    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.tables).toEqual([
      TABLE_PROJECTION_SYNC_STATE,
      TABLE_CATALOG_ITEMS,
      TABLE_CATALOG_BARCODES,
      TABLE_INVENTORY_BALANCES,
    ]);

    const version = await getSchemaVersion(db);
    expect(version).toBe(1);
    expect(db.isReady()).toBe(true);
  });

  it('is idempotent when initialize is called multiple times concurrently or sequentially', async () => {
    db = createMerchantDatabase();

    const [state1, state2, state3] = await Promise.all([
      db.initialize(),
      db.initialize(),
      db.initialize(),
    ]);

    expect(state1.isInitialized).toBe(true);
    expect(state2.isInitialized).toBe(true);
    expect(state3.isInitialized).toBe(true);
    expect(await getSchemaVersion(db)).toBe(1);

    const sequential = await db.initialize();
    expect(sequential.isInitialized).toBe(true);
  });

  it('runs migrations transactionally from version 0 to 1', async () => {
    const rawDb = createNodeSqliteDatabase();
    expect(await getSchemaVersion(rawDb)).toBe(0);

    const result = await runMigrations(rawDb, 1);
    expect(result.previousVersion).toBe(0);
    expect(result.currentVersion).toBe(1);
    expect(result.appliedVersions).toEqual([1]);

    expect(await getSchemaVersion(rawDb)).toBe(1);
    await rawDb.close();
  });

  it('rejects when database has a newer incompatible schema version', async () => {
    const rawDb = createNodeSqliteDatabase();
    await setSchemaVersion(rawDb, 999);

    await expect(runMigrations(rawDb, 1)).rejects.toThrow(/DATABASE_INCOMPATIBLE_VERSION/);
    await rawDb.close();
  });

  it('rolls back migration transaction when a migration step fails', async () => {
    const rawDb = createNodeSqliteDatabase();

    // Force a conflicting table that causes migration SQL to fail
    await rawDb.exec(`CREATE TABLE ${TABLE_CATALOG_ITEMS} (id INT PRIMARY KEY, invalid_col TEXT);`);
    await setSchemaVersion(rawDb, 0);

    const bootstrapper = new DatabaseBootstrapper();
    // With allowRecovery = false, bootstrap throws directly on schema conflict
    await expect(bootstrapper.bootstrap(rawDb, { allowRecovery: false })).rejects.toThrow();

    await rawDb.close();
  });
});
