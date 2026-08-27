import { ExpoSqliteDriver, type NativeExpoSqliteInstance, type NativeExpoTransaction } from '../expo-driver';

describe('M5 Expo SQLite Driver Adapter and Transaction Isolation', () => {
  it('prefers withExclusiveTransactionAsync on native platforms, returns callback value, and delegates to scoped handle', async () => {
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
      // Real Expo method returns Promise<void>
      withExclusiveTransactionAsync: async (action: (tx: NativeExpoTransaction) => Promise<void>): Promise<void> => {
        await action(mockNativeTx);
      },
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    const result = await driver.transaction(async (tx) => {
      await tx.exec('CREATE TABLE test_tx (id TEXT);');
      await tx.run('INSERT INTO test_tx VALUES (?);', ['abc']);
      const row = await tx.get<{ id: string }>('SELECT * FROM test_tx;');
      const rows = await tx.all<{ id: string }>('SELECT * FROM test_tx;');
      return { value: 123, row, rows };
    });

    expect(mockNativeTx.execAsync).toHaveBeenCalledWith('CREATE TABLE test_tx (id TEXT);');
    expect(mockNativeTx.runAsync).toHaveBeenCalledWith('INSERT INTO test_tx VALUES (?);', 'abc');
    expect(mockNativeTx.getFirstAsync).toHaveBeenCalledWith('SELECT * FROM test_tx;');
    expect(mockNativeTx.getAllAsync).toHaveBeenCalledWith('SELECT * FROM test_tx;');
    expect(result).toEqual({
      value: 123,
      row: { id: 'row-1', value: 'test' },
      rows: [{ id: 'row-1' }],
    });
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
      withExclusiveTransactionAsync: async (action: (tx: NativeExpoTransaction) => Promise<void>): Promise<void> => {
        await action(mockNativeTx);
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

  it('blocks out-of-transaction direct operations during withTransactionAsync fallback (operation gate)', async () => {
    const executionOrder: string[] = [];

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockImplementation(async () => {
        executionOrder.push('native_exec');
      }),
      runAsync: jest.fn().mockImplementation(async () => {
        executionOrder.push('native_run');
        return { changes: 1, lastInsertRowId: 1 };
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      // Real Expo withTransactionAsync signature takes zero arguments and returns Promise<void>
      withTransactionAsync: async (action: () => Promise<void>): Promise<void> => {
        await action();
      },
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    let releaseTransaction!: () => void;
    const holdTxPromise = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    let txEntered = false;
    let outerRunCompleted = false;

    // 1. Start fallback transaction and hold it
    const txPromise = driver.transaction(async (tx) => {
      txEntered = true;
      executionOrder.push('tx_started');
      // Internal query via scoped tx
      await tx.run('INSERT INTO tx_internal VALUES (1);');
      await holdTxPromise;
      executionOrder.push('tx_committing');
      return { status: 'TX_SUCCESS' };
    });

    // Wait until transaction body is active
    while (!txEntered) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // 2. Start direct driver.run outside transaction while transaction is held
    const outerRunPromise = driver
      .run('UPDATE outside SET value = 1;')
      .then((res) => {
        outerRunCompleted = true;
        executionOrder.push('outer_run_done');
        return res;
      });

    // 3. Prove outside operation has NOT executed while transaction is active
    await new Promise((r) => setTimeout(r, 25));
    expect(outerRunCompleted).toBe(false);
    expect(executionOrder).toEqual(['tx_started', 'native_run']);

    // 4. Release transaction
    releaseTransaction();

    // 5. Await both transaction and outside operation
    const [txResult, outerResult] = await Promise.all([txPromise, outerRunPromise]);

    expect(txResult).toEqual({ status: 'TX_SUCCESS' });
    expect(outerResult).toEqual({ changes: 1, lastInsertRowId: 1 });
    expect(outerRunCompleted).toBe(true);

    // 6. Prove outside operation ran strictly after transaction completion
    expect(executionOrder).toEqual([
      'tx_started',
      'native_run',
      'tx_committing',
      'native_run',
      'outer_run_done',
    ]);
  });

  it('serializes concurrent transactions via operation gate in non-exclusive/web environments', async () => {
    const executionOrder: string[] = [];

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      withTransactionAsync: async (action: () => Promise<void>): Promise<void> => {
        await action();
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
