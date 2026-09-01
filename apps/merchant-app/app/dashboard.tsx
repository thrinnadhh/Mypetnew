import { router, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import { fetchMerchantCatalogContext, type MerchantCatalogContext } from '../src/catalog/api';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext } from '../src/data/models/partition-context';
import {
  ActionCard,
  BottomNavigation,
  EmptyState,
  ErrorState,
  LoadingState,
  MerchantHeader,
  MerchantScreen,
  MetricCard,
  OfflineBanner,
  SectionHeader,
  SyncStateMode,
  colors,
  radius,
  spacing,
  typography,
} from '../src/design';
import {
  dashboardCards,
  fetchMerchantDashboard,
  type MerchantDashboardSnapshot,
} from '../src/operations/dashboard';
import { canManageStaff } from '../src/operations/staff';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';

export type DashboardContentProps = {
  showHomeLink?: boolean;
  onSignOut?: () => void;
};

export function MerchantDashboardContent({ showHomeLink = false, onSignOut }: DashboardContentProps) {
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();
  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [dashboard, setDashboard] = useState<MerchantDashboardSnapshot>();
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  const load = useCallback(async (context: MerchantCatalogContext, selectedOutlet?: string) => {
    setMessage('');
    setSyncMessage('');
    try {
      const canonical = await fetchMerchantDashboard(selectedOutlet);
      setDashboard(canonical);

      try {
        if (!outboxRepo || !syncStateRepo || !context.organizationId) {
          setSync(undefined);
          return;
        }
        const accountId = await loadOfflineMerchantAccountId();
        if (!accountId) {
          setSync(undefined);
          return;
        }
        const organizationId = context.organizationId;
        const outletIds = selectedOutlet ? [selectedOutlet] : canonical.outletIds;
        const partitions = outletIds.map((id) => createPartitionContext(accountId, organizationId, id));
        setSync(await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo));
      } catch {
        setSync(undefined);
        setSyncMessage('Local sync health could not be read from this device.');
      }
    } catch (error) {
      setDashboard(undefined);
      setSync(undefined);
      setMessage(error instanceof Error ? error.message : 'Dashboard unavailable.');
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
        await load(context);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Dashboard unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [load]);

  const cards = useMemo(() => dashboard ? dashboardCards(dashboard) : [], [dashboard]);

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

  const staffOutletId = outletId
    ? (canManageStaff(merchantContext?.permissionsByOutlet[outletId] ?? []) ? outletId : undefined)
    : merchantContext?.outletIds.find((id) => canManageStaff(merchantContext.permissionsByOutlet[id] ?? []));

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
    if (!merchantContext || loading) return;
    setOutletId(selected);
    setLoading(true);
    void (async () => {
      await load(merchantContext, selected);
      setLoading(false);
    })();
  }

  const moreMenuItems = useMemo(() => {
    const items = [
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
        badge: dashboard?.metrics.pendingAppointments,
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
    ];

    if (staffOutletId) {
      items.push({
        key: 'staff',
        label: 'Staff Permissions',
        icon: '👥',
        subtitle: 'Manage roles and authorizations',
        onPress: () => router.push({ pathname: '/staff', params: { outletId: staffOutletId } }),
      });
    }

    if (onSignOut) {
      items.push({
        key: 'signout',
        label: 'Sign Out',
        icon: '🚪',
        subtitle: 'Exit merchant session',
        onPress: onSignOut,
      });
    }

    return items;
  }, [dashboard?.metrics.pendingAppointments, onSignOut, pendingCount, staffOutletId]);

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
        onAccountPress={onSignOut}
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
        contentContainerStyle={styles.scrollBody}
      >
        {loading ? (
          <LoadingState message="Loading operations dashboard…" testID="dashboard-loading-view" />
        ) : message ? (
          <ErrorState
            title="Dashboard Unavailable"
            message={message}
            onRetry={() => merchantContext ? void load(merchantContext, outletId) : undefined}
            retryTitle="Retry Connection"
            testID="dashboard-error-view"
          />
        ) : dashboard ? (
          <>
            <View style={styles.syncStatusCard}>
              <View style={styles.syncStatusHeader}>
                <Text style={styles.syncStatusTitle}>Device & Cloud Sync</Text>
                <Text style={styles.syncTimestamp}>
                  {new Date(dashboard.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={styles.syncStatusBody}>
                {sync
                  ? `Pending: ${sync.commands.pending} · Sending: ${sync.commands.sending} · Retry: ${sync.commands.retry} · Acknowledged: ${sync.commands.acknowledged}`
                  : (syncMessage || 'All systems synchronized with canonical server.')}
              </Text>
            </View>

            <SectionHeader
              title="Today's Summary"
              subtitle="Canonical server metrics across selected scope"
            />

            <View style={styles.metricGrid}>
              {cards.map((card) => (
                <View key={card.key} style={styles.metricCardCol}>
                  <MetricCard
                    label={card.label}
                    value={card.value}
                    detail={card.detail}
                    onPress={() => router.push(card.destination as Href)}
                    accentColor={
                      card.key === 'outOfStockInventory' || card.key === 'lowStockInventory'
                        ? card.value > 0 ? colors.warning : colors.slate700
                        : card.key === 'pendingAppointments' && card.value > 0
                        ? colors.primary
                        : colors.slate800
                    }
                    badgeText={card.value > 0 && card.key === 'pendingAppointments' ? 'Action Needed' : undefined}
                    testID={`metric-card-${card.key}`}
                  />
                </View>
              ))}
            </View>

            <SectionHeader
              title="Quick Operations"
              subtitle="High-frequency store actions"
            />

            <View style={styles.actionsList}>
              <ActionCard
                title="Scan Barcode"
                subtitle="Offline barcode lookup and product draft onboarding"
                icon="📷"
                variant="primary"
                onPress={() => router.push('/barcode')}
                testID="quick-action-barcode"
              />
              <ActionCard
                title="Order Work"
                subtitle="Live order queue and fulfilment transitions"
                icon="📦"
                badge={dashboard.metrics.orderWork > 0 ? dashboard.metrics.orderWork : undefined}
                onPress={() => router.push('/orders')}
                testID="quick-action-orders"
              />
              <ActionCard
                title="Stock Ledger & Inventory"
                subtitle="Count sessions, receiving, adjustments, returns"
                icon="📊"
                badge={dashboard.metrics.lowStockInventory > 0 ? `${dashboard.metrics.lowStockInventory} Low` : undefined}
                onPress={() => router.push('/inventory')}
                testID="quick-action-inventory"
              />
              <ActionCard
                title="Catalog Listings"
                subtitle="Product listings, prices, images & synchronization"
                icon="🏷️"
                onPress={() => router.push('/catalog')}
                testID="quick-action-catalog"
              />
            </View>
          </>
        ) : (
          <EmptyState
            title="No Operational Data"
            description="The dashboard received no data for the selected outlet."
            actionTitle="Refresh"
            onAction={() => merchantContext ? void load(merchantContext, outletId) : undefined}
          />
        )}
      </MerchantScreen>

      <BottomNavigation
        activeTab="home"
        onTabPress={(tab) => {
          if (tab === 'orders') router.push('/orders');
          else if (tab === 'inventory') router.push('/inventory');
          else if (tab === 'catalog') router.push('/catalog');
          else if (tab === 'home') void refresh();
        }}
        orderBadge={dashboard?.metrics.orderWork}
        moreMenuItems={moreMenuItems}
      />
    </View>
  );
}

export default function MerchantDashboardScreen() {
  return <MerchantDashboardContent />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceDim,
  },
  scrollBody: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  syncStatusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  syncStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncStatusTitle: {
    ...typography.labelMd,
    color: colors.slate900,
    fontWeight: '700',
  },
  syncTimestamp: {
    ...typography.bodySm,
    color: colors.slate500,
  },
  syncStatusBody: {
    ...typography.bodySm,
    color: colors.slate600,
    lineHeight: 18,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricCardCol: {
    width: '48%',
    minWidth: 150,
  },
  actionsList: {
    gap: spacing.sm,
  },
});
