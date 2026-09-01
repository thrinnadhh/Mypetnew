import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import {
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  type MerchantCatalogContext,
  type MerchantListing,
} from '../src/catalog/api';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext } from '../src/data/models/partition-context';
import {
  BottomNavigation,
  EmptyState,
  ErrorState,
  FilterBar,
  type FilterOption,
  InventoryCard,
  type InventorySyncState,
  LoadingState,
  MerchantHeader,
  MerchantScreen,
  MovementLedgerModal,
  SearchInput,
  StockAdjustmentModal,
  type StockOperationMode,
  type SyncStateMode,
  colors,
  spacing,
  typography,
} from '../src/design';
import {
  createInventoryAdjustmentCommand,
  fetchInventoryBalance,
  fetchInventoryMovements,
  startStockCount,
  submitDamage,
  submitExpiry,
  submitInventoryAdjustment,
  submitReceiving,
  submitReturn,
  submitShrinkage,
  submitStockCount,
  submitTransfer,
  updateStockCountLines,
  type InventoryAdjustmentCommand,
  type InventoryAdjustmentReason,
  type InventoryBalance,
  type InventoryCountSession,
  type InventoryMovement,
} from '../src/inventory/api';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';

export type InventoryFilter = 'ALL' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'PENDING_SYNC';

type InventoryItemView = {
  listing: MerchantListing;
  balance: InventoryBalance;
  syncState: InventorySyncState;
  pendingCommand?: InventoryAdjustmentCommand;
};

export default function MerchantInventoryScreen() {
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();
  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [items, setItems] = useState<InventoryItemView[]>([]);
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<InventoryFilter>('ALL');
  const [canWrite, setCanWrite] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals state
  const [activeAdjustItem, setActiveAdjustItem] = useState<InventoryItemView | null>(null);
  const [adjustInitialMode, setAdjustInitialMode] = useState<StockOperationMode>('ADJUSTMENT');
  const [ledgerItem, setLedgerItem] = useState<InventoryItemView | null>(null);
  const [ledgerMovements, setLedgerMovements] = useState<InventoryMovement[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [countSession, setCountSession] = useState<InventoryCountSession>();

  const load = useCallback(async (selectedOutlet?: string) => {
    setMessage('');
    try {
      if (!selectedOutlet) {
        setItems([]);
        return;
      }
      const catalogResult = await fetchCatalogPage(selectedOutlet, { pageSize: 50 });
      const listings = catalogResult.items;

      const balancePromises = listings.map(async (listing) => {
        try {
          const bal = await fetchInventoryBalance(selectedOutlet, listing.id);
          return {
            listing,
            balance: bal,
            syncState: 'Canonical' as InventorySyncState,
          };
        } catch {
          // Fallback to local default / cached balance
          return {
            listing,
            balance: {
              organizationId: listing.organizationId,
              outletId: selectedOutlet,
              listingId: listing.id,
              onHand: 0,
              reserved: 0,
              available: 0,
              version: 0,
              updatedAt: new Date().toISOString(),
            },
            syncState: 'Cached' as InventorySyncState,
          };
        }
      });

      const loadedItems = await Promise.all(balancePromises);
      setItems(loadedItems);

      if (outboxRepo && syncStateRepo && merchantContext?.organizationId) {
        try {
          const accountId = await loadOfflineMerchantAccountId();
          if (accountId) {
            const orgId = merchantContext.organizationId;
            const outletIds = [selectedOutlet];
            const partitions = outletIds.map((id) => createPartitionContext(accountId, orgId, id));
            setSync(await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo));
          }
        } catch {
          // Local sync reading error
        }
      }
    } catch (error) {
      setItems([]);
      setMessage(error instanceof Error ? error.message : 'Inventory unavailable.');
    }
  }, [merchantContext, outboxRepo, syncStateRepo]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(outletId);
    setRefreshing(false);
  }, [load, outletId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setMerchantContext(context);
        const initialOutlet = context.outletIds[0];
        if (initialOutlet) {
          setOutletId(initialOutlet);
          const permissions = context.permissionsByOutlet[initialOutlet] ?? [];
          setCanWrite(permissions.includes('OWNER') || permissions.includes('INVENTORY_WRITE') || permissions.includes('CATALOG_WRITE'));
          await load(initialOutlet);
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Inventory unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [load]);

  const outletOptions = useMemo(() => {
    if (!merchantContext) return [];
    return merchantContext.outletIds.map((id, index) => ({
      id,
      name: `Outlet ${index + 1} (${id.slice(0, 8)})`,
    }));
  }, [merchantContext]);

  const currentOutletName = useMemo(() => {
    if (!outletId) return 'All Outlets';
    const found = outletOptions.find((o) => o.id === outletId);
    return found ? found.name : outletId;
  }, [outletId, outletOptions]);

  const syncMode: SyncStateMode = useMemo(() => {
    if (message && message.toLowerCase().includes('network')) return 'offline';
    if (!sync) return 'online';
    if (sync.commands.rejected > 0 || sync.commands.blocked > 0) return 'failed';
    if (sync.commands.sending > 0) return 'syncing';
    if (sync.commands.pending > 0 || sync.commands.retry > 0) return 'pending';
    return 'online';
  }, [message, sync]);

  const pendingCount = sync ? (sync.commands.pending + sync.commands.retry + sync.commands.reconciliation) : 0;

  function handleSelectOutlet(selected?: string) {
    if (!selected) return;
    setOutletId(selected);
    const permissions = merchantContext?.permissionsByOutlet[selected] ?? [];
    setCanWrite(permissions.includes('OWNER') || permissions.includes('INVENTORY_WRITE') || permissions.includes('CATALOG_WRITE'));
    setLoading(true);
    void (async () => {
      await load(selected);
      setLoading(false);
    })();
  }

  // Filter options with counts
  const filterOptions: FilterOption<InventoryFilter>[] = useMemo(() => {
    const lowStockCount = items.filter((i) => i.balance.available > 0 && i.balance.available <= 5).length;
    const outOfStockCount = items.filter((i) => i.balance.available <= 0).length;
    const pendingCount = items.filter((i) => i.syncState === 'Pending sync').length;

    return [
      { id: 'ALL', label: 'All Stock', badge: items.length || undefined },
      { id: 'LOW_STOCK', label: 'Low Stock', badge: lowStockCount || undefined },
      { id: 'OUT_OF_STOCK', label: 'Out of Stock', badge: outOfStockCount || undefined },
      { id: 'PENDING_SYNC', label: 'Pending Sync', badge: pendingCount || undefined },
    ];
  }, [items]);

  // Filtered and searched items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedFilter === 'LOW_STOCK' && (item.balance.available <= 0 || item.balance.available > 5)) {
        return false;
      }
      if (selectedFilter === 'OUT_OF_STOCK' && item.balance.available > 0) {
        return false;
      }
      if (selectedFilter === 'PENDING_SYNC' && item.syncState !== 'Pending sync') {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = item.listing.name.toLowerCase().includes(q);
        const matchesSku = item.listing.sku?.toLowerCase().includes(q) ?? false;
        const matchesBarcode = item.listing.normalizedBarcode.toLowerCase().includes(q);
        const matchesCategory = item.listing.category.toLowerCase().includes(q);
        return matchesName || matchesSku || matchesBarcode || matchesCategory;
      }
      return true;
    });
  }, [items, searchQuery, selectedFilter]);

  // Movement operations handlers
  async function handleManualAdjustment(units: number, isDecrease: boolean, reason: InventoryAdjustmentReason) {
    if (!outletId || !activeAdjustItem) return;
    const command = createInventoryAdjustmentCommand({
      outletId,
      listingId: activeAdjustItem.listing.id,
      quantityDelta: isDecrease ? -units : units,
      reason,
    });
    try {
      await submitInventoryAdjustment(command);
      setMessage(`Stock adjustment of ${isDecrease ? '-' : '+'}${units} units applied.`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Inventory update failed.');
      throw err;
    }
  }

  async function handleReceiving(units: number, refType?: string, refId?: string, batchNo?: string, expiryDate?: string) {
    if (!outletId || !activeAdjustItem) return;
    try {
      await submitReceiving({
        outletId,
        listingId: activeAdjustItem.listing.id,
        quantity: units,
        referenceType: refType,
        referenceId: refId,
        batchNumber: batchNo,
        expiryDate,
      });
      setMessage(`Recorded receiving of ${units} units.`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Receiving failed.');
      throw err;
    }
  }

  async function handleDamage(units: number, details?: string, refId?: string) {
    if (!outletId || !activeAdjustItem) return;
    try {
      await submitDamage({
        outletId,
        listingId: activeAdjustItem.listing.id,
        quantity: units,
        reasonDetails: details,
        referenceId: refId,
      });
      setMessage(`Recorded damaged stock of ${units} units.`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Damage write-off failed.');
      throw err;
    }
  }

  async function handleExpiry(units: number, batchNo?: string, expiryDate?: string) {
    if (!outletId || !activeAdjustItem) return;
    try {
      await submitExpiry({
        outletId,
        listingId: activeAdjustItem.listing.id,
        quantity: units,
        batchReference: batchNo,
        expiryDate,
      });
      setMessage(`Recorded ${units} expired units.`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Expiry recording failed.');
      throw err;
    }
  }

  async function handleShrinkage(units: number, notes?: string, refId?: string) {
    if (!outletId || !activeAdjustItem) return;
    try {
      await submitShrinkage({
        outletId,
        listingId: activeAdjustItem.listing.id,
        quantity: units,
        notes,
        referenceId: refId,
      });
      setMessage(`Recorded shrinkage of ${units} units.`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Shrinkage recording failed.');
      throw err;
    }
  }

  async function handleReturn(units: number, returnType: 'CUSTOMER_RETURN' | 'VENDOR_RETURN', refId?: string) {
    if (!outletId || !activeAdjustItem) return;
    try {
      await submitReturn({
        outletId,
        listingId: activeAdjustItem.listing.id,
        quantity: units,
        returnType,
        referenceId: refId,
      });
      setMessage(`Recorded return of ${units} units.`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Return failed.');
      throw err;
    }
  }

  async function handleTransfer(units: number, destinationOutletId: string) {
    if (!outletId || !activeAdjustItem) return;
    try {
      await submitTransfer({
        sourceOutletId: outletId,
        destinationOutletId,
        sourceListingId: activeAdjustItem.listing.id,
        quantity: units,
      });
      setMessage(`Transferred ${units} units to outlet ${destinationOutletId.slice(0, 8)}…`);
      await load(outletId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Transfer failed.');
      throw err;
    }
  }

  async function handleStartCount(): Promise<InventoryCountSession> {
    if (!outletId) throw new Error('Outlet ID required.');
    const session = await startStockCount(outletId);
    setCountSession(session);
    return session;
  }

  async function handleAddCountLine(sessionId: string, qty: number) {
    if (!outletId || !activeAdjustItem) return;
    const updated = await updateStockCountLines(outletId, sessionId, [
      { listingId: activeAdjustItem.listing.id, countedQuantity: qty },
    ]);
    setCountSession(updated);
  }

  async function handleSubmitCount(sessionId: string) {
    if (!outletId) return;
    const res = await submitStockCount(outletId, sessionId);
    setMessage(`Count submitted: ${res.lines.length} line(s) reconciled.`);
    await load(outletId);
  }

  async function openMovementLedger(item: InventoryItemView) {
    if (!outletId) return;
    setLedgerItem(item);
    setLedgerLoading(true);
    try {
      const page = await fetchInventoryMovements(outletId, item.listing.id, 0, 50);
      setLedgerMovements(page.items);
    } catch {
      setLedgerMovements([]);
    } finally {
      setLedgerLoading(false);
    }
  }

  function openAdjustment(item: InventoryItemView, mode: StockOperationMode = 'ADJUSTMENT') {
    setActiveAdjustItem(item);
    setAdjustInitialMode(mode);
  }

  const moreMenuItems = useMemo(() => [
    {
      key: 'barcode',
      label: 'Barcode Scanner',
      icon: '📷',
      subtitle: 'Scan & onboard products offline',
      onPress: () => router.push('/barcode'),
    },
    {
      key: 'appointments',
      label: 'Booking Requests',
      icon: '📅',
      subtitle: 'Grooming & vet appointments',
      onPress: () => router.push('/appointments'),
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: '🔔',
      subtitle: 'Inbox & operational alerts',
      onPress: () => router.push('/notifications'),
    },
    {
      key: 'sync',
      label: 'Sync & Conflicts',
      icon: '🔄',
      subtitle: 'Device outbox and sync status',
      badge: pendingCount > 0 ? pendingCount : undefined,
      onPress: () => router.push('/sync-status'),
    },
  ], [pendingCount]);

  return (
    <View style={styles.container}>
      <MerchantHeader
        outletName={currentOutletName}
        businessName="MyPet Merchant"
        outlets={outletOptions}
        selectedOutletId={outletId}
        onSelectOutlet={handleSelectOutlet}
        syncMode={syncMode}
        pendingSyncCount={pendingCount}
        onSyncPress={() => router.push('/sync-status')}
        onNotificationsPress={() => router.push('/notifications')}
      />

      <MerchantScreen
        showHeader={false}
        scrollable
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        offlineBannerProps={
          syncMode === 'offline' || pendingCount > 0 || syncMode === 'failed'
            ? {
                variant: syncMode === 'failed' ? 'failed' : pendingCount > 0 ? 'pending' : 'offline',
                pendingCount,
                onAction: () => router.push('/sync-status'),
                actionLabel: syncMode === 'failed' ? 'Resolve' : 'View Sync',
              }
            : undefined
        }
        showBottomNav={false}
        contentContainerStyle={styles.content}
      >
        {/* Controls Section */}
        <View style={styles.controls}>
          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search product, SKU, barcode, category…"
            onBarcodeScan={() => router.push('/barcode')}
            accessibilityLabel="Search inventory"
            testID="inventory-search-input"
          />

          <FilterBar
            options={filterOptions}
            selectedId={selectedFilter}
            onSelect={setSelectedFilter}
            testID="inventory-filter-bar"
          />
        </View>

        {/* Notice/Alert Banner */}
        {message ? (
          <View style={styles.noticeBanner}>
            <Text accessibilityRole="alert" style={styles.noticeText}>
              {message}
            </Text>
          </View>
        ) : null}

        {/* List Content */}
        {loading ? (
          <LoadingState message="Loading inventory & stock balances…" testID="inventory-loading-view" />
        ) : filteredItems.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title="No Inventory Items"
              description="No catalog products found in this outlet."
              actionTitle="Scan / Add Products"
              onAction={() => router.push('/barcode')}
              testID="inventory-empty-state"
            />
          ) : (
            <EmptyState
              title="No Matching Items"
              description={`No stock matches filter "${selectedFilter}" or query "${searchQuery}".`}
              actionTitle="Clear Filters"
              onAction={() => {
                setSelectedFilter('ALL');
                setSearchQuery('');
              }}
              testID="inventory-filtered-empty-state"
            />
          )
        ) : (
          <View style={styles.inventoryList}>
            {filteredItems.map((item) => (
              <InventoryCard
                key={item.listing.id}
                balance={item.balance}
                listingName={item.listing.name}
                sku={item.listing.sku}
                barcode={item.listing.normalizedBarcode}
                category={item.listing.category}
                syncStatus={item.syncState}
                canWrite={canWrite}
                onAdjust={() => openAdjustment(item, 'ADJUSTMENT')}
                onReceive={() => openAdjustment(item, 'RECEIVING')}
                onMoreOps={() => openAdjustment(item, 'DAMAGE')}
                onViewLedger={() => void openMovementLedger(item)}
                testID={`inventory-card-${item.listing.id}`}
              />
            ))}
          </View>
        )}
      </MerchantScreen>

      {/* Stock Adjustment & Operations Modal */}
      {activeAdjustItem ? (
        <StockAdjustmentModal
          visible={Boolean(activeAdjustItem)}
          listingId={activeAdjustItem.listing.id}
          listingName={activeAdjustItem.listing.name}
          currentBalance={activeAdjustItem.balance}
          initialMode={adjustInitialMode}
          onClose={() => setActiveAdjustItem(null)}
          onManualAdjustment={handleManualAdjustment}
          onReceiving={handleReceiving}
          onDamage={handleDamage}
          onExpiry={handleExpiry}
          onShrinkage={handleShrinkage}
          onReturn={handleReturn}
          onTransfer={handleTransfer}
          onStartCount={handleStartCount}
          onAddCountLine={handleAddCountLine}
          onSubmitCount={handleSubmitCount}
          countSession={countSession}
          testID="stock-adjustment-modal"
        />
      ) : null}

      {/* Movement Ledger Modal */}
      {ledgerItem ? (
        <MovementLedgerModal
          visible={Boolean(ledgerItem)}
          listingName={ledgerItem.listing.name}
          movements={ledgerMovements}
          loading={ledgerLoading}
          onClose={() => setLedgerItem(null)}
          testID="movement-ledger-modal"
        />
      ) : null}

      <BottomNavigation
        activeTab="inventory"
        onTabPress={(tab) => {
          if (tab === 'home') router.push('/dashboard');
          else if (tab === 'orders') router.push('/orders');
          else if (tab === 'catalog') router.push('/catalog');
          else if (tab === 'inventory') void refresh();
        }}
        moreMenuItems={moreMenuItems}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceDim,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  controls: {
    gap: spacing.xs,
  },
  noticeBanner: {
    backgroundColor: colors.warningContainer,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  noticeText: {
    ...typography.bodyMd,
    color: colors.onWarningContainer,
    fontWeight: '600',
  },
  inventoryList: {
    gap: spacing.md,
  },
});
