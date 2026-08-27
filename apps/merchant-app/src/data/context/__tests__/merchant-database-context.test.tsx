import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as databaseModule from '../../database/database';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import { MerchantDatabaseProvider, useMerchantDatabase } from '../merchant-database-context';

function TestConsumer() {
  const { isReady, isLoading, error, catalogRepo, inventoryRepo } = useMerchantDatabase();

  if (isLoading) return React.createElement('span', { testID: 'loading' }, 'Loading');
  if (error) return React.createElement('span', { testID: 'error' }, error.message);
  if (isReady && catalogRepo && inventoryRepo) {
    return React.createElement('span', { testID: 'ready' }, 'Ready');
  }
  return null;
}

describe('M5 MerchantDatabaseProvider Lifecycle and Ownership Policy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes database and exposes repositories to consumers', async () => {
    const db = createNodeSqliteDatabase(':memory:');

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(
        React.createElement(
          MerchantDatabaseProvider,
          { databaseInstance: db },
          React.createElement(TestConsumer, null),
        ),
      );
    });

    const readyEl = testRenderer!.root.findByProps({ testID: 'ready' });
    expect(readyEl).toBeDefined();

    await db.close();
  });

  it('A) owned database opens -> unmount -> close called once', async () => {
    const underlyingDb = createNodeSqliteDatabase(':memory:');
    let closeCallCount = 0;
    const originalClose = underlyingDb.close.bind(underlyingDb);
    underlyingDb.close = async () => {
      closeCallCount += 1;
      return originalClose();
    };

    const mockMerchantDb = new databaseModule.MerchantDatabase(underlyingDb);

    jest
      .spyOn(databaseModule, 'createProductionMerchantDatabase')
      .mockResolvedValue(mockMerchantDb);

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(
        React.createElement(
          MerchantDatabaseProvider,
          null,
          React.createElement(TestConsumer, null),
        ),
      );
    });

    const readyEl = testRenderer!.root.findByProps({ testID: 'ready' });
    expect(readyEl).toBeDefined();
    expect(closeCallCount).toBe(0);

    // Unmount provider
    await act(async () => {
      testRenderer!.unmount();
    });

    // Invariant: owned database closed exactly once
    expect(closeCallCount).toBe(1);
  });

  it('B) owned database opens -> initialize fails -> close called once', async () => {
    const failingDriver = {
      isOpen: () => true,
      exec: jest.fn().mockRejectedValue(new Error('INIT_FAIL')),
      run: jest.fn().mockRejectedValue(new Error('INIT_FAIL')),
      get: jest.fn().mockRejectedValue(new Error('INIT_FAIL')),
      all: jest.fn().mockRejectedValue(new Error('INIT_FAIL')),
      transaction: jest.fn().mockRejectedValue(new Error('INIT_FAIL')),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const mockFailingDb = new databaseModule.MerchantDatabase(failingDriver);

    jest
      .spyOn(databaseModule, 'createProductionMerchantDatabase')
      .mockResolvedValue(mockFailingDb);

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(
        React.createElement(
          MerchantDatabaseProvider,
          null,
          React.createElement(TestConsumer, null),
        ),
      );
    });

    const errorEl = testRenderer!.root.findByProps({ testID: 'error' });
    expect(errorEl.props.children).toContain('INIT_FAIL');

    // Invariant: closed on initialization failure
    expect(failingDriver.close).toHaveBeenCalledTimes(1);
  });

  it('C) unmount occurs while initialize is pending -> closes handle and avoids state update', async () => {
    const closeFn = jest.fn().mockResolvedValue(undefined);
    let isOpen = true;

    let resolveInit!: () => void;
    const initPromise = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });

    const pendingDb = {
      isOpen: () => isOpen,
      initialize: jest.fn().mockImplementation(async () => {
        await initPromise;
        return {
          schemaVersion: 2,
          migrationsApplied: [],
          status: 'READY',
        };
      }),
      isReady: () => true,
      getRecoveryManager: () => ({}),
      getUnderlyingDriver: () => pendingDb,
      exec: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      get: jest.fn().mockResolvedValue(null),
      all: jest.fn().mockResolvedValue([]),
      transaction: jest.fn().mockImplementation(async (cb) => cb(pendingDb)),
      close: closeFn.mockImplementation(async () => {
        isOpen = false;
      }),
    } as unknown as databaseModule.MerchantDatabase;

    jest
      .spyOn(databaseModule, 'createProductionMerchantDatabase')
      .mockResolvedValue(pendingDb);

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(
        React.createElement(
          MerchantDatabaseProvider,
          null,
          React.createElement(TestConsumer, null),
        ),
      );
    });

    // Unmount before initialization finishes
    await act(async () => {
      testRenderer!.unmount();
    });

    // Now let initialize complete
    await act(async () => {
      resolveInit();
    });

    // Invariant: closed once, no crash or state update leak
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('D) injected external database is NOT closed by provider unmount or failure', async () => {
    const externalDb = createNodeSqliteDatabase(':memory:');
    let closeCallCount = 0;
    const originalClose = externalDb.close.bind(externalDb);
    externalDb.close = async () => {
      closeCallCount += 1;
      return originalClose();
    };

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(
        React.createElement(
          MerchantDatabaseProvider,
          { databaseInstance: externalDb },
          React.createElement(TestConsumer, null),
        ),
      );
    });

    await act(async () => {
      testRenderer!.unmount();
    });

    // Invariant: external DB lifecycle belongs to caller, NOT provider
    expect(closeCallCount).toBe(0);

    await originalClose();
  });
});
