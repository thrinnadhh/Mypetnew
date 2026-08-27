import { DatabaseBootstrapper } from '../bootstrap';
import { getSchemaVersion, setSchemaVersion } from '../migrations';
import { createNodeSqliteDatabase } from '../node-driver';
import { DatabaseRecoveryManager } from '../recovery';
import {
  CURRENT_SCHEMA_VERSION,
  TABLE_CATALOG_BARCODES,
  TABLE_CATALOG_ITEMS,
  TABLE_INVENTORY_BALANCES,
  TABLE_PROJECTION_SYNC_STATE,
  TABLE_PROJECTION_TOMBSTONES,
} from '../schema';

describe('M5 SQLite Recovery and Fail-Closed Behavior', () => {
  it('FAILS CLOSED on newer database version without destroying data or attempting recovery', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const recoveryManager = new DatabaseRecoveryManager();
    const bootstrapper = new DatabaseBootstrapper(recoveryManager);

    // 1. Initial bootstrap to v2
    await bootstrapper.bootstrap(db);

    // 2. Create sentinel table and data
    await db.exec('CREATE TABLE sentinel_app_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);');
    await db.run('INSERT INTO sentinel_app_data (id, value) VALUES (?, ?);', [
      'sentinel-1',
      'vital_user_state',
    ]);

    // Insert sample projection data
    await db.run(
      `INSERT INTO ${TABLE_CATALOG_ITEMS} (
        account_id, organization_id, outlet_id, id, name, kind, commerce_mode,
        barcode_type, normalized_barcode, mrp_paise, selling_price_paise,
        category, status, version, server_created_at, server_updated_at, local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        'acc-1',
        'org-1',
        'out-1',
        'prod-1',
        'Test Food',
        'FOOD',
        'PICKUP',
        'INTERNAL',
        'TF-001',
        1000,
        900,
        'Food',
        'ACTIVE',
        1,
        '2026-08-27T00:00:00.000Z',
        '2026-08-27T00:00:00.000Z',
        '2026-08-27T00:00:00.000Z',
      ],
    );

    // 3. Set PRAGMA user_version = CURRENT_SCHEMA_VERSION + 1 (simulating DB created by newer binary)
    const futureVersion = CURRENT_SCHEMA_VERSION + 1;
    await setSchemaVersion(db, futureVersion);

    // Reset bootstrapper state to simulate a new process startup
    bootstrapper.reset();

    // 4. Call NORMAL/default bootstrap with recovery enabled
    // 5. Assert DATABASE_INCOMPATIBLE_VERSION is thrown
    await expect(bootstrapper.bootstrap(db, { allowRecovery: true })).rejects.toThrow(
      'DATABASE_INCOMPATIBLE_VERSION',
    );

    // 6. Assert user_version remains unchanged
    const versionAfter = await getSchemaVersion(db);
    expect(versionAfter).toBe(futureVersion);

    // 7. Assert sentinel table and data remain completely untouched
    const sentinelRow = await db.get<{ id: string; value: string }>(
      'SELECT * FROM sentinel_app_data WHERE id = ?;',
      ['sentinel-1'],
    );
    expect(sentinelRow).toEqual({ id: 'sentinel-1', value: 'vital_user_state' });

    // 8. Assert projection state was not dropped
    const catalogRow = await db.get<{ id: string; name: string }>(
      `SELECT id, name FROM ${TABLE_CATALOG_ITEMS} WHERE id = ?;`,
      ['prod-1'],
    );
    expect(catalogRow).toEqual({ id: 'prod-1', name: 'Test Food' });

    // 9. Assert recoveryCount remains zero
    expect(recoveryManager.getRecoveryCount()).toBe(0);
    expect(recoveryManager.getLastDiagnostic()).toBeNull();

    await db.close();
  });

  it('detects corrupted projection schema and executes clean bounded recovery', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const recoveryManager = new DatabaseRecoveryManager();
    const bootstrapper = new DatabaseBootstrapper(recoveryManager);

    // Bootstrap first
    await bootstrapper.bootstrap(db);

    // Corrupt the schema by dropping a required table
    await db.exec(`DROP TABLE ${TABLE_PROJECTION_TOMBSTONES};`);

    bootstrapper.reset();

    // Next bootstrap detects corruption and recovers
    const result = await bootstrapper.bootstrap(db, { allowRecovery: true });
    expect(result.isInitialized).toBe(true);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    expect(recoveryManager.getRecoveryCount()).toBe(1);
    const diag = recoveryManager.getLastDiagnostic();
    expect(diag?.recovered).toBe(true);

    // Verify all 5 tables exist after recovery
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain(TABLE_PROJECTION_SYNC_STATE);
    expect(tableNames).toContain(TABLE_CATALOG_ITEMS);
    expect(tableNames).toContain(TABLE_CATALOG_BARCODES);
    expect(tableNames).toContain(TABLE_INVENTORY_BALANCES);
    expect(tableNames).toContain(TABLE_PROJECTION_TOMBSTONES);

    await db.close();
  });

  it('bounds recovery to maximum 1 attempt to avoid infinite loops', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const recoveryManager = new DatabaseRecoveryManager();

    // Trigger initial recovery
    await recoveryManager.recoverProjectionDatabase(db, new Error('SQLITE_CORRUPT: disk malformed'));
    expect(recoveryManager.getRecoveryCount()).toBe(1);

    // Attempt second recovery within same manager lifecycle
    await expect(
      recoveryManager.recoverProjectionDatabase(db, new Error('SQLITE_CORRUPT: disk malformed again')),
    ).rejects.toThrow('DATABASE_RECOVERY_ABORTED: Maximum recovery attempts exceeded');

    await db.close();
  });
});
