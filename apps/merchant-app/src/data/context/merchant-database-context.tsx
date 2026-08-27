import React, { createContext, useContext, useEffect, useState } from 'react';
import { MerchantDatabase, createProductionMerchantDatabase } from '../database/database';
import type { SqliteDatabase } from '../database/driver';
import { BarcodeLocalRepository } from '../repositories/barcode-local-repository';
import { CatalogLocalRepository } from '../repositories/catalog-local-repository';
import { InventoryLocalRepository } from '../repositories/inventory-local-repository';
import { SyncStateRepository } from '../repositories/sync-state-repository';

export type MerchantDatabaseContextState = {
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
  database: MerchantDatabase | null;
  catalogRepo: CatalogLocalRepository | null;
  barcodeRepo: BarcodeLocalRepository | null;
  inventoryRepo: InventoryLocalRepository | null;
  syncStateRepo: SyncStateRepository | null;
};

const defaultState: MerchantDatabaseContextState = {
  isReady: false,
  isLoading: true,
  error: null,
  database: null,
  catalogRepo: null,
  barcodeRepo: null,
  inventoryRepo: null,
  syncStateRepo: null,
};

const MerchantDatabaseContext = createContext<MerchantDatabaseContextState>(defaultState);

export type MerchantDatabaseProviderProps = {
  children?: React.ReactNode;
  databaseInstance?: SqliteDatabase;
  dbName?: string;
};

export function MerchantDatabaseProvider({
  children,
  databaseInstance,
  dbName = 'mypetnew_merchant.db',
}: MerchantDatabaseProviderProps) {
  const [state, setState] = useState<MerchantDatabaseContextState>(defaultState);

  useEffect(() => {
    let isCancelled = false;
    let activeOwnedDb: MerchantDatabase | null = null;
    const ownsDatabase = databaseInstance == null;

    async function cleanupDb(dbToClose: MerchantDatabase | null) {
      if (ownsDatabase && dbToClose && dbToClose.isOpen()) {
        try {
          await dbToClose.close();
        } catch {
          // Ignore error during cleanup close
        }
      }
    }

    async function initDatabase() {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        let db: MerchantDatabase;
        if (databaseInstance) {
          db = new MerchantDatabase(databaseInstance);
        } else {
          db = await createProductionMerchantDatabase(dbName);
          activeOwnedDb = db;
        }

        if (isCancelled) {
          await cleanupDb(activeOwnedDb);
          return;
        }

        await db.initialize();

        if (isCancelled) {
          await cleanupDb(activeOwnedDb);
          return;
        }

        const catalogRepo = new CatalogLocalRepository(db);
        const barcodeRepo = new BarcodeLocalRepository(db);
        const inventoryRepo = new InventoryLocalRepository(db);
        const syncStateRepo = new SyncStateRepository(db);

        setState({
          isReady: true,
          isLoading: false,
          error: null,
          database: db,
          catalogRepo,
          barcodeRepo,
          inventoryRepo,
          syncStateRepo,
        });
      } catch (err) {
        await cleanupDb(activeOwnedDb);
        if (isCancelled) return;

        const error = err instanceof Error ? err : new Error(String(err));
        setState({
          isReady: false,
          isLoading: false,
          error,
          database: null,
          catalogRepo: null,
          barcodeRepo: null,
          inventoryRepo: null,
          syncStateRepo: null,
        });
      }
    }

    void initDatabase();

    return () => {
      isCancelled = true;
      void cleanupDb(activeOwnedDb);
    };
  }, [databaseInstance, dbName]);

  return (
    <MerchantDatabaseContext.Provider value={state}>
      {children}
    </MerchantDatabaseContext.Provider>
  );
}

export function useMerchantDatabase(): MerchantDatabaseContextState {
  return useContext(MerchantDatabaseContext);
}
