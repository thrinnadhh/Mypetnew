import { ExpoSqliteDriver } from '../expo-driver';

describe('M5 Expo SQLite Driver Adapter', () => {
  let mockExpoDb: {
    execAsync: jest.Mock;
    runAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    getAllAsync: jest.Mock;
    withTransactionAsync: jest.Mock;
    closeAsync: jest.Mock;
  };
  let driver: ExpoSqliteDriver;

  beforeEach(() => {
    mockExpoDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 10 }),
      getFirstAsync: jest.fn().mockResolvedValue({ id: 'row-1', value: 'test' }),
      getAllAsync: jest.fn().mockResolvedValue([{ id: 'row-1' }, { id: 'row-2' }]),
      withTransactionAsync: jest.fn((action: () => Promise<unknown>) => action()),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    driver = new ExpoSqliteDriver(mockExpoDb);
  });

  it('delegates execAsync, runAsync, getFirstAsync, getAllAsync correctly', async () => {
    expect(driver.isOpen()).toBe(true);

    await driver.exec('PRAGMA user_version;');
    expect(mockExpoDb.execAsync).toHaveBeenCalledWith('PRAGMA user_version;');

    const runResult = await driver.run('INSERT INTO test VALUES (?);', ['val']);
    expect(runResult).toEqual({ changes: 1, lastInsertRowId: 10 });
    expect(mockExpoDb.runAsync).toHaveBeenCalledWith('INSERT INTO test VALUES (?);', 'val');

    const first = await driver.get<{ id: string }>('SELECT * FROM test WHERE id = ?;', ['row-1']);
    expect(first).toEqual({ id: 'row-1', value: 'test' });

    const all = await driver.all<{ id: string }>('SELECT * FROM test;');
    expect(all).toHaveLength(2);
  });

  it('delegates transaction execution and closes cleanly', async () => {
    let executedInTx = false;
    const txResult = await driver.transaction(async () => {
      executedInTx = true;
      return 'tx-success';
    });

    expect(executedInTx).toBe(true);
    expect(txResult).toBe('tx-success');

    await driver.close();
    expect(mockExpoDb.closeAsync).toHaveBeenCalled();
    expect(driver.isOpen()).toBe(false);

    await expect(driver.exec('SELECT 1;')).rejects.toThrow('DATABASE_CLOSED');
  });
});
