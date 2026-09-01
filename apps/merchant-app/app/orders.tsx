import { router, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import { fetchMerchantCatalogContext, type MerchantCatalogContext } from '../src/catalog/api';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext } from '../src/data/models/partition-context';
import {
  BottomNavigation,
  ConfirmationModal,
  EmptyState,
  ErrorState,
  FilterBar,
  type FilterOption,
  LoadingState,
  MerchantHeader,
  MerchantScreen,
  OrderCard,
  OrderDetailModal,
  SearchInput,
  type SyncStateMode,
  colors,
  spacing,
  typography,
} from '../src/design';
import {
  fetchMerchantOrderWork,
  orderTargets,
  transitionMerchantOrder,
  type MerchantOrderStatus,
  type MerchantOrderWorkItem,
} from '../src/operations/orders';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';

export type OrderFilterStatus = 'ALL' | MerchantOrderStatus;

export default function MerchantOrdersScreen() {
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();
  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [items, setItems] = useState<MerchantOrderWorkItem[]>([]);
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<OrderFilterStatus>('ALL');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals state
  const [activeDetailOrder, setActiveDetailOrder] = useState<MerchantOrderWorkItem | null>(null);
  const [confirmModalOrder, setConfirmModalOrder] = useState<MerchantOrderWorkItem | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<MerchantOrderStatus | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const load = useCallback(async (context: MerchantCatalogContext, selectedOutlet?: string) => {
    setMessage('');
    try {
      const page = await fetchMerchantOrderWork(selectedOutlet);
      setItems(page.items);

      if (outboxRepo && syncStateRepo && context.organizationId) {
        try {
          const accountId = await loadOfflineMerchantAccountId();
          if (accountId) {
            const orgId = context.organizationId;
            const outletIds = selectedOutlet ? [selectedOutlet] : context.outletIds;
            const partitions = outletIds.map((id) => createPartitionContext(accountId, orgId, id));
            setSync(await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo));
          }
        } catch {
          // Local sync reading error is secondary
        }
      }
    } catch (error) {
      setItems([]);
      setMessage(error instanceof Error ? error.message : 'Order workload is currently unavailable.');
    }
  }, [outboxRepo, syncStateRepo]);

  const refresh = useCallback(async () => {
    if (!merchantContext) return;
    setRefreshing(true);
    await load(merchantContext, outletId);
    setRefreshing(false);
  }, [load, merchantContext, outletId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setMerchantContext(context);
        const initialOutlet = context.outletIds[0];
        setOutletId(initialOutlet);
        await load(context, initialOutlet);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Orders unavailable.');
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
    setOutletId(selected);
    setLoading(true);
    void (async () => {
      if (merchantContext) await load(merchantContext, selected);
      setLoading(false);
    })();
  }

  // Filter options with counts
  const filterOptions: FilterOption<OrderFilterStatus>[] = useMemo(() => {
    const counts: Record<string, number> = { ALL: items.length };
    items.forEach((item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    });

    return [
      { id: 'ALL', label: 'All Orders', badge: counts.ALL || undefined },
      { id: 'PLACED', label: 'New', badge: counts.PLACED || undefined },
      { id: 'ACCEPTED', label: 'Accepted', badge: counts.ACCEPTED || undefined },
      { id: 'PREPARING', label: 'Preparing', badge: counts.PREPARING || undefined },
      { id: 'READY_FOR_PICKUP', label: 'Ready', badge: counts.READY_FOR_PICKUP || undefined },
      { id: 'PICKED_UP', label: 'Picked Up', badge: counts.PICKED_UP || undefined },
      { id: 'DELIVERED', label: 'Delivered', badge: counts.DELIVERED || undefined },
      { id: 'REJECTED', label: 'Rejected', badge: counts.REJECTED || undefined },
      { id: 'CANCELLED', label: 'Cancelled', badge: counts.CANCELLED || undefined },
    ];
  }, [items]);

  // Filtered and searched items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedStatus !== 'ALL' && item.status !== selectedStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesOrderNo = item.orderNumber.toLowerCase().includes(q);
        const matchesPayment = item.paymentStatus.toLowerCase().includes(q);
        const matchesMode = item.fulfilmentMode.toLowerCase().includes(q);
        return matchesOrderNo || matchesPayment || matchesMode;
      }
      return true;
    });
  }, [items, searchQuery, selectedStatus]);

  async function executeTransition(order: MerchantOrderWorkItem, target: MerchantOrderStatus, reason?: string) {
    if (busyId) return;
    setBusyId(order.orderId);
    setMessage('');
    try {
      await transitionMerchantOrder(order, target, reason);
      if (activeDetailOrder?.orderId === order.orderId) {
        setActiveDetailOrder(null);
      }
      if (merchantContext) await load(merchantContext, outletId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Order state transition failed.');
    } finally {
      setBusyId(undefined);
    }
  }

  function handleOrderTransition(order: MerchantOrderWorkItem, target: MerchantOrderStatus) {
    const destructive = target === 'REJECTED' || target === 'CANCELLED';
    if (destructive) {
      setConfirmModalOrder(order);
      setConfirmTarget(target);
      return;
    }
    void executeTransition(order, target);
  }

  async function handleConfirmDestructive(reason?: string) {
    if (!confirmModalOrder || !confirmTarget) return;
    setConfirmLoading(true);
    try {
      await executeTransition(confirmModalOrder, confirmTarget, reason);
      setConfirmModalOrder(null);
      setConfirmTarget(null);
    } finally {
      setConfirmLoading(false);
    }
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
        {/* Controls Section: Search & Filters */}
        <View style={styles.controls}>
          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search order #, mode, payment…"
            accessibilityLabel="Search orders"
            testID="orders-search-input"
          />

          <FilterBar
            options={filterOptions}
            selectedId={selectedStatus}
            onSelect={setSelectedStatus}
            testID="orders-filter-bar"
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
          <LoadingState message="Loading live order workload…" testID="orders-loading-view" />
        ) : filteredItems.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title="No Active Orders"
              description="New incoming orders and current fulfillment workloads will appear here."
              actionTitle="Refresh"
              onAction={() => void refresh()}
              testID="orders-empty-state"
            />
          ) : (
            <EmptyState
              title="No Matching Orders"
              description={`No orders match the "${selectedStatus}" filter or "${searchQuery}" query.`}
              actionTitle="Clear Filters"
              onAction={() => {
                setSelectedStatus('ALL');
                setSearchQuery('');
              }}
              testID="orders-filtered-empty-state"
            />
          )
        ) : (
          <View style={styles.orderList}>
            {filteredItems.map((order) => {
              const isBusy = busyId === order.orderId;
              const targets = orderTargets(order);
              return (
                <OrderCard
                  key={order.orderId}
                  order={order}
                  availableTargets={targets}
                  onTransition={handleOrderTransition}
                  onViewDetails={setActiveDetailOrder}
                  busy={isBusy}
                  testID={`order-card-${order.orderId}`}
                />
              );
            })}
          </View>
        )}
      </MerchantScreen>

      {/* Order Detail Modal */}
      <OrderDetailModal
        visible={Boolean(activeDetailOrder)}
        order={activeDetailOrder}
        availableTargets={activeDetailOrder ? orderTargets(activeDetailOrder) : []}
        onClose={() => setActiveDetailOrder(null)}
        onTransition={handleOrderTransition}
        busy={Boolean(busyId && activeDetailOrder && busyId === activeDetailOrder.orderId)}
        testID="order-detail-modal"
      />

      {/* Destructive Action Reason Modal */}
      <ConfirmationModal
        visible={Boolean(confirmModalOrder && confirmTarget)}
        title={confirmTarget === 'REJECTED' ? 'Reject Order' : 'Cancel Order'}
        message={`Are you sure you want to ${confirmTarget === 'REJECTED' ? 'reject' : 'cancel'} order ${confirmModalOrder?.orderNumber}? This action is permanent.`}
        confirmLabel={confirmTarget === 'REJECTED' ? 'Reject Order' : 'Cancel Order'}
        variant="destructive"
        requireReason={true}
        reasonLabel="Reason for store rejection / cancellation"
        reasonPlaceholder="e.g. Item out of stock, store closing soon…"
        loading={confirmLoading}
        onConfirm={(reason) => void handleConfirmDestructive(reason)}
        onCancel={() => {
          setConfirmModalOrder(null);
          setConfirmTarget(null);
        }}
        testID="order-confirm-modal"
      />

      <BottomNavigation
        activeTab="orders"
        onTabPress={(tab) => {
          if (tab === 'home') router.push('/dashboard');
          else if (tab === 'inventory') router.push('/inventory');
          else if (tab === 'catalog') router.push('/catalog');
          else if (tab === 'orders') void refresh();
        }}
        orderBadge={items.length > 0 ? items.length : undefined}
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
  orderList: {
    gap: spacing.md,
  },
});
