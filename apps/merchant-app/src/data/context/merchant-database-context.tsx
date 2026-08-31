import React, { createContext, useContext, useEffect, useState } from 'react';
import { MerchantDatabase, createProductionMerchantDatabase } from '../database/database';
import type { SqliteDatabase } from '../database/driver';
import { BarcodeLocalRepository } from '../repositories/barcode-local-repository';
import { CatalogLocalRepository } from '../repositories/catalog-local-repository';
import { CommandOutboxRepository } from '../repositories/command-outbox-repository';
import { DraftLocalRepository } from '../repositories/draft-local-repository';
import { InventoryLocalRepository } from '../repositories/inventory-local-repository';
import { PendingMediaRepository } from '../repositories/pending-media-repository';
import { SyncStateRepository } from '../repositories/sync-state-repository';

export type MerchantDatabaseContextState = {
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
  database: MerchantDatabase | null;
  catalogRepo: CatalogLocalRepository | null;
  outboxRepo: CommandOutboxRepository | null;
  barcodeRepo: BarcodeLocalRepository | null;
  draftRepo: DraftLocalRepository | null;
  inventoryRepo: InventoryLocalRepository | null;
  pendingMediaRepo: PendingMediaRepository | null;
  syncStateRepo: SyncStateRepository | null;
};

const defaultState: MerchantDatabaseContextState = {
  isReady: false,
  isLoading: true,
  error: null,
  database: null,
  catalogRepo: null,
  outboxRepo: null,
  barcodeRepo: null,
  draftRepo: null,
  inventoryRepo: null,
  pendingMediaRepo: null,
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
          // Ignore cleanup failures during unmount.
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

        setState({
          isReady: true,
          isLoading: false,
          error: null,
          database: db,
          catalogRepo: new CatalogLocalRepository(db),
          outboxRepo: new CommandOutboxRepository(db),
          barcodeRepo: new BarcodeLocalRepository(db),
          draftRepo: new DraftLocalRepository(db),
          inventoryRepo: new InventoryLocalRepository(db),
          pendingMediaRepo: new PendingMediaRepository(db),
          syncStateRepo: new SyncStateRepository(db),
        });
      } catch (err) {
        await cleanupDb(activeOwnedDb);
        if (isCancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ ...defaultState, isLoading: false, error });
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
