import { ExpoSqliteDriver, type NativeExpoSqliteInstance, type NativeExpoTransaction } from '../expo-driver';

describe('M5 Expo SQLite Driver Adapter and Transaction Isolation', () => {
  it('prefers withExclusiveTransactionAsync on native platforms and delegates to scoped transaction handle', async () => {
    const mockNativeTx: NativeExpoTransaction = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 10 }),
      getFirstAsync: jest.fn().mockResolvedValue({ id: 'row-1', value: 'test' }),
      getAllAsync: jest.fn().mockResolvedValue([{ id: 'row-1' }]),
    };

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      withExclusiveTransactionAsync: async <T>(action: (tx: NativeExpoTransaction) => Promise<T>): Promise<T> => {
        return action(mockNativeTx);
      },
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    const result = await driver.transaction(async (tx) => {
      await tx.exec('CREATE TABLE test_tx (id TEXT);');
      await tx.run('INSERT INTO test_tx VALUES (?);', ['abc']);
      const row = await tx.get<{ id: string }>('SELECT * FROM test_tx;');
      const rows = await tx.all<{ id: string }>('SELECT * FROM test_tx;');
      return { row, rows };
    });

    expect(mockNativeTx.execAsync).toHaveBeenCalledWith('CREATE TABLE test_tx (id TEXT);');
    expect(mockNativeTx.runAsync).toHaveBeenCalledWith('INSERT INTO test_tx VALUES (?);', 'abc');
    expect(mockNativeTx.getFirstAsync).toHaveBeenCalledWith('SELECT * FROM test_tx;');
    expect(mockNativeTx.getAllAsync).toHaveBeenCalledWith('SELECT * FROM test_tx;');
    expect(result.row).toEqual({ id: 'row-1', value: 'test' });
  });

  it('rolls back transaction on error under withExclusiveTransactionAsync', async () => {
    const mockNativeTx: NativeExpoTransaction = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
    };

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      withExclusiveTransactionAsync: async <T>(action: (tx: NativeExpoTransaction) => Promise<T>): Promise<T> => {
        return action(mockNativeTx);
      },
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    await expect(
      driver.transaction(async (tx) => {
        await tx.exec('INSERT INTO broken VALUES (1);');
        throw new Error('TX_SIMULATED_FAIL');
      }),
    ).rejects.toThrow('TX_SIMULATED_FAIL');
  });

  it('serializes concurrent transactions via mutex fallback in non-exclusive/web environments', async () => {
    const executionOrder: string[] = [];

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      // No withExclusiveTransactionAsync available (e.g. web environment)
      withTransactionAsync: async <T>(action: (tx: NativeExpoTransaction) => Promise<T>): Promise<T> => {
        return action(mockExpoDb);
      },
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    const p1 = driver.transaction(async () => {
      executionOrder.push('t1_start');
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push('t1_end');
      return 't1_done';
    });

    const p2 = driver.transaction(async () => {
      executionOrder.push('t2_start');
      await new Promise((r) => setTimeout(r, 5));
      executionOrder.push('t2_end');
      return 't2_done';
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('t1_done');
    expect(r2).toBe('t2_done');
    // Transactions must not interleave
    expect(executionOrder).toEqual(['t1_start', 't1_end', 't2_start', 't2_end']);
  });

  it('closes cleanly and rejects operations after close', async () => {
    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);
    expect(driver.isOpen()).toBe(true);

    await driver.close();
    expect(mockExpoDb.closeAsync).toHaveBeenCalled();
    expect(driver.isOpen()).toBe(false);

    await expect(driver.exec('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');
    await expect(driver.run('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');
    await expect(driver.get('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');
    await expect(driver.all('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');
    await expect(driver.transaction(async () => {})).rejects.toThrow('DATABASE_CLOSED');
  });
});
