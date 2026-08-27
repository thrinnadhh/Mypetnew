import React from 'react';
import renderer, { act } from 'react-test-renderer';
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

describe('M5 MerchantDatabaseProvider Lifecycle', () => {
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

  it('exposes explicit error state when initialization fails without crashing or infinite render loops', async () => {
    const failingDb = {
      isOpen: () => true,
      exec: jest.fn().mockRejectedValue(new Error('CRITICAL_BOOTSTRAP_FAIL')),
      run: jest.fn().mockRejectedValue(new Error('CRITICAL_BOOTSTRAP_FAIL')),
      get: jest.fn().mockRejectedValue(new Error('CRITICAL_BOOTSTRAP_FAIL')),
      all: jest.fn().mockRejectedValue(new Error('CRITICAL_BOOTSTRAP_FAIL')),
      transaction: jest.fn().mockRejectedValue(new Error('CRITICAL_BOOTSTRAP_FAIL')),
      close: jest.fn().mockResolvedValue(undefined),
    };

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(
        React.createElement(
          MerchantDatabaseProvider,
          { databaseInstance: failingDb },
          React.createElement(TestConsumer, null),
        ),
      );
    });

    const errorEl = testRenderer!.root.findByProps({ testID: 'error' });
    expect(errorEl.props.children).toContain('CRITICAL_BOOTSTRAP_FAIL');
  });
});
