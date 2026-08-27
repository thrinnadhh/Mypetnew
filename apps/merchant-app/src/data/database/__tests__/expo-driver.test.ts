import { Platform } from 'react-native';
import {
  ExpoSqliteDriver,
  createExpoSqliteDatabase,
  type NativeExpoSqliteInstance,
  type NativeExpoTransaction,
} from '../expo-driver';

describe('M5 Expo SQLite Driver Adapter and Transaction Isolation', () => {
  const originalPlatformOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalPlatformOS;
    jest.restoreAllMocks();
  });

  it('prefers withExclusiveTransactionAsync on native platforms (android/ios) and returns callback value', async () => {
    Platform.OS = 'android';

    const mockNativeTx: NativeExpoTransaction = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 10 }),
      getFirstAsync: jest.fn().mockResolvedValue({ id: 'row-1', value: 'test' }),
      getAllAsync: jest.fn().mockResolvedValue([{ id: 'row-1' }]),
    };

    const exclusiveTxSpy = jest
      .fn()
      .mockImplementation(async (action: (tx: NativeExpoTransaction) => Promise<void>): Promise<void> => {
        await action(mockNativeTx);
      });

    const fallbackTxSpy = jest.fn().mockImplementation(async (action: () => Promise<void>): Promise<void> => {
      await action();
    });

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      withExclusiveTransactionAsync: exclusiveTxSpy,
      withTransactionAsync: fallbackTxSpy,
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

    expect(exclusiveTxSpy).toHaveBeenCalledTimes(1);
    expect(fallbackTxSpy).not.toHaveBeenCalled();
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

  it('avoids withExclusiveTransactionAsync on web even when method exists and uses serialized withTransactionAsync', async () => {
    Platform.OS = 'web';

    const exclusiveTxSpy = jest.fn().mockImplementation(async () => {
      throw new Error('withExclusiveTransactionAsync is not supported on web');
    });

    const fallbackTxSpy = jest.fn().mockImplementation(async (action: () => Promise<void>): Promise<void> => {
      await action();
    });

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue({ id: 'web-row-1' }),
      getAllAsync: jest.fn().mockResolvedValue([{ id: 'web-row-1' }]),
      // Real Expo web has both methods on prototype, but exclusive throws if invoked
      withExclusiveTransactionAsync: exclusiveTxSpy,
      withTransactionAsync: fallbackTxSpy,
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    const result = await driver.transaction(async (tx) => {
      await tx.exec('CREATE TABLE web_test (id TEXT);');
      await tx.run('INSERT INTO web_test VALUES (?);', ['web-1']);
      const row = await tx.get<{ id: string }>('SELECT * FROM web_test;');
      return { success: true, row };
    });

    // Invariant: withExclusiveTransactionAsync must NEVER be called on web
    expect(exclusiveTxSpy).not.toHaveBeenCalled();
    expect(fallbackTxSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      row: { id: 'web-row-1' },
    });
  });

  it('rolls back transaction on error under withExclusiveTransactionAsync', async () => {
    Platform.OS = 'android';

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
    Platform.OS = 'web';
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
      await tx.run('INSERT INTO tx_internal VALUES (1);');
      await holdTxPromise;
      executionOrder.push('tx_committing');
      return { status: 'TX_SUCCESS' };
    });

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

  it('serializes close vs active transaction, rejects new operations, and closes native handle once', async () => {
    Platform.OS = 'android';
    const executionOrder: string[] = [];

    const closeAsyncMock = jest.fn().mockImplementation(async () => {
      executionOrder.push('native_closeAsync');
    });

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockImplementation(async () => {
        executionOrder.push('native_run');
        return { changes: 1, lastInsertRowId: 1 };
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      withExclusiveTransactionAsync: async (action: (tx: NativeExpoTransaction) => Promise<void>): Promise<void> => {
        await action(mockExpoDb);
      },
      closeAsync: closeAsyncMock,
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    let releaseTx!: () => void;
    const holdTxPromise = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });

    let txActive = false;

    // 1. Start transaction and hold it
    const txPromise = driver.transaction(async (tx) => {
      txActive = true;
      executionOrder.push('tx_running');
      await tx.run('INSERT INTO tx_item VALUES (1);');
      await holdTxPromise;
      executionOrder.push('tx_done');
      return 'TX_RESULT';
    });

    while (!txActive) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // 2. Call driver.close() while transaction is held
    const closePromise = driver.close().then(() => {
      executionOrder.push('driver_closed');
    });

    // 3. Assert native closeAsync has NOT executed yet
    await new Promise((r) => setTimeout(r, 20));
    expect(closeAsyncMock).not.toHaveBeenCalled();
    expect(driver.isOpen()).toBe(false);

    // 4. Assert a new direct operation is immediately rejected because close is pending
    await expect(driver.run('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');

    // 5. Release transaction
    releaseTx();

    // 6. Await transaction and close
    const txResult = await txPromise;
    await closePromise;

    expect(txResult).toBe('TX_RESULT');
    expect(closeAsyncMock).toHaveBeenCalledTimes(1);
    expect(executionOrder).toEqual([
      'tx_running',
      'native_run',
      'tx_done',
      'native_closeAsync',
      'driver_closed',
    ]);

    // 7. Subsequent operations fail closed
    await expect(driver.exec('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');
  });

  it('handles simultaneous close calls cleanly and calls native closeAsync exactly once', async () => {
    const closeAsyncMock = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: closeAsyncMock,
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    await Promise.all([driver.close(), driver.close(), driver.close()]);

    expect(closeAsyncMock).toHaveBeenCalledTimes(1);
    expect(driver.isOpen()).toBe(false);
  });

  it('handles native closeAsync failure deterministically without false successful closed state', async () => {
    const mockExpoDb: NativeExpoSqliteInstance = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockRejectedValue(new Error('NATIVE_CLOSE_DISK_FAIL')),
    };

    const driver = new ExpoSqliteDriver(mockExpoDb);

    await expect(driver.close()).rejects.toThrow('NATIVE_CLOSE_DISK_FAIL');

    // Should not claim it successfully closed when native handle failed to close
    expect(driver.isOpen()).toBe(true);
  });

  it('closes opened native DB handle if PRAGMA initialization fails in factory', async () => {
    const mockNativeDb: NativeExpoSqliteInstance = {
      execAsync: jest
        .fn()
        .mockResolvedValueOnce(undefined) // journal_mode
        .mockRejectedValueOnce(new Error('FOREIGN_KEY_PRAGMA_FAILED')),
      runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };

    const mockOpenDb = jest.fn().mockResolvedValue(mockNativeDb);

    await expect(createExpoSqliteDatabase('test_fail.db', mockOpenDb)).rejects.toThrow(
      'FOREIGN_KEY_PRAGMA_FAILED',
    );
    expect(mockNativeDb.closeAsync).toHaveBeenCalledTimes(1);
  });
});
