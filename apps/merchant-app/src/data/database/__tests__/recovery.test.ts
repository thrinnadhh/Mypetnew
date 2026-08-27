import { DatabaseBootstrapper } from '../bootstrap';
import { createMerchantDatabase, MerchantDatabase } from '../database';
import { getSchemaVersion } from '../migrations';
import { createNodeSqliteDatabase } from '../node-driver';
import { DatabaseRecoveryManager } from '../recovery';
import { TABLE_CATALOG_ITEMS } from '../schema';

describe('M5 Database Recovery and Corruption Protection', () => {
  let db: MerchantDatabase;

  afterEach(async () => {
    if (db && db.isOpen()) {
      await db.close();
    }
  });

  it('detects recoverable errors accurately', () => {
    const manager = new DatabaseRecoveryManager();

    expect(manager.isRecoverableError(new Error('SQLITE_CORRUPT: database disk image is malformed'))).toBe(true);
    expect(manager.isRecoverableError(new Error('database disk image is malformed'))).toBe(true);
    expect(manager.isRecoverableError(new Error('MIGRATION_VERIFICATION_FAILED: table missing'))).toBe(true);
    expect(manager.isRecoverableError(new Error('DATABASE_INCOMPATIBLE_VERSION'))).toBe(true);
    expect(manager.isRecoverableError(new Error('NETWORK_TIMEOUT'))).toBe(false);
  });

  it('recovers from corrupt/incompatible schema automatically during bootstrap', async () => {
    const rawDb = createNodeSqliteDatabase();
    // Simulate corrupt table with incompatible schema
    await rawDb.exec(`CREATE TABLE ${TABLE_CATALOG_ITEMS} (corrupt_col INT PRIMARY KEY);`);
    await rawDb.exec('PRAGMA user_version = 1;'); // claims version 1 but schema is invalid

    const recoveryManager = new DatabaseRecoveryManager();
    const bootstrapper = new DatabaseBootstrapper(recoveryManager);

    db = new MerchantDatabase(rawDb, bootstrapper);
    const state = await db.initialize();

    expect(state.isInitialized).toBe(true);
    expect(state.schemaVersion).toBe(1);
    expect(recoveryManager.getRecoveryCount()).toBe(1);

    const diag = recoveryManager.getLastDiagnostic();
    expect(diag).not.toBeNull();
    expect(diag?.recovered).toBe(true);

    const version = await getSchemaVersion(rawDb);
    expect(version).toBe(1);
  });

  it('bounds recovery to 1 attempt to prevent infinite restart/recreation loops', async () => {
    const rawDb = createNodeSqliteDatabase();
    const recoveryManager = new DatabaseRecoveryManager();

    // Manually force recovery count to 1
    await recoveryManager.recoverProjectionDatabase(rawDb, new Error('First corruption'));
    expect(recoveryManager.getRecoveryCount()).toBe(1);

    // Second recovery attempt must fail closed and throw DATABASE_RECOVERY_ABORTED
    await expect(
      recoveryManager.recoverProjectionDatabase(rawDb, new Error('Second corruption')),
    ).rejects.toThrow(/DATABASE_RECOVERY_ABORTED/);

    await rawDb.close();
  });
});
