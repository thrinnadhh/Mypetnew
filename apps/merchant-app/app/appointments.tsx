import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  appointmentTargets,
  fetchMerchantAppointment,
  fetchMerchantAppointments,
  transitionMerchantAppointment,
  type MerchantAppointmentRequest,
  type MerchantAppointmentStatus,
} from '../src/appointments/api';
import {
  appointmentStatusLabel,
  prioritizeAppointmentNavigation,
} from '../src/appointments/model';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import { hasRuntimeMerchantSession } from '../src/auth/session';
import { fetchMerchantCatalogContext, type MerchantCatalogContext } from '../src/catalog/api';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext } from '../src/data/models/partition-context';
import {
  AppointmentCard,
  AppointmentDetailModal,
  BottomNavigation,
  ConfirmationModal,
  EmptyState,
  FilterBar,
  type FilterOption,
  LoadingState,
  MerchantHeader,
  MerchantScreen,
  MetricCard,
  SearchInput,
  type SyncStateMode,
  colors,
  radius,
  spacing,
  typography,
} from '../src/design';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';

export type AppointmentFilterStatus =
  | 'ALL'
  | 'BOOKED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'CLOSED';

export default function MerchantAppointmentsScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();

  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [items, setItems] = useState<MerchantAppointmentRequest[]>([]);
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<AppointmentFilterStatus>('ALL');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Modals state
  const [manualSelectedId, setManualSelectedId] = useState<string | null>(null);
  const [hasDismissedDeepLink, setHasDismissedDeepLink] = useState(false);
  const [confirmModalAppointment, setConfirmModalAppointment] = useState<MerchantAppointmentRequest | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<MerchantAppointmentStatus | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const activeAppointmentId = manualSelectedId ?? (!hasDismissedDeepLink && appointmentId ? appointmentId : null);
  const activeDetailAppointment = useMemo(() => {
    if (!activeAppointmentId) return null;
    return items.find((item) => item.appointmentId === activeAppointmentId) ?? null;
  }, [activeAppointmentId, items]);

  const handleOpenDetail = useCallback((appointment: MerchantAppointmentRequest) => {
    setManualSelectedId(appointment.appointmentId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setManualSelectedId(null);
    setHasDismissedDeepLink(true);
  }, []);

  const load = useCallback(async (selectedOutlet?: string) => {
    setMessage('');
    if (!hasRuntimeMerchantSession()) {
      setLoading(false);
      return;
    }
    try {
      const page = await fetchMerchantAppointments({
        outletId: selectedOutlet,
        pageSize: 100,
      });
      setItems(page.items);
      setIsOffline(false);

      if (outboxRepo && syncStateRepo && merchantContext?.organizationId) {
        try {
          const accountId = await loadOfflineMerchantAccountId();
          if (accountId) {
            const orgId = merchantContext.organizationId;
            const outletIds = selectedOutlet ? [selectedOutlet] : merchantContext.outletIds;
            const partitions = outletIds.map((id) => createPartitionContext(accountId, orgId, id));
            setSync(await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo));
          }
        } catch {
          // Sync reading error is secondary
        }
      }
    } catch (error) {
      const isNetworkError = error instanceof Error && /network|fetch|offline|failed to fetch/i.test(error.message);
      if (isNetworkError) {
        setIsOffline(true);
        setMessage('Offline: Displaying cached appointment workload.');
      } else {
        setItems([]);
        setMessage(error instanceof Error ? error.message : 'Appointments workload is currently unavailable.');
      }
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
        setOutletId(initialOutlet);
        await load(initialOutlet);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Appointments unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
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
    if (isOffline || (message && message.toLowerCase().includes('network'))) return 'offline';
    if (!sync) return 'online';
    if (sync.commands.rejected > 0 || sync.commands.blocked > 0) return 'failed';
    if (sync.commands.sending > 0) return 'syncing';
    if (sync.commands.pending > 0 || sync.commands.retry > 0) return 'pending';
    return 'online';
  }, [isOffline, message, sync]);

  const pendingCount = sync ? sync.commands.pending + sync.commands.retry + sync.commands.reconciliation : 0;

  function handleSelectOutlet(selected?: string) {
    setOutletId(selected);
    setLoading(true);
    void (async () => {
      await load(selected);
      setLoading(false);
    })();
  }

  // Summary Metrics Counts
  const metrics = useMemo(() => {
    let booked = 0;
    let inService = 0;
    let completed = 0;
    items.forEach((item) => {
      if (item.status === 'BOOKED') booked += 1;
      else if (item.status === 'IN_SERVICE' || item.status === 'CHECKED_IN') inService += 1;
      else if (item.status === 'COMPLETED') completed += 1;
    });
    return {
      total: items.length,
      booked,
      inService,
      completed,
    };
  }, [items]);

  // Filter options with counts
  const filterOptions: FilterOption<AppointmentFilterStatus>[] = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: items.length,
      BOOKED: 0,
      CONFIRMED: 0,
      CHECKED_IN: 0,
      IN_SERVICE: 0,
      COMPLETED: 0,
      CLOSED: 0,
    };
    items.forEach((item) => {
      if (counts[item.status] !== undefined) {
        counts[item.status] += 1;
      }
      if (item.status === 'CANCELLED' || item.status === 'REJECTED' || item.status === 'NO_SHOW') {
        counts.CLOSED += 1;
      }
    });

    return [
      { id: 'ALL', label: 'All', badge: counts.ALL || undefined },
      { id: 'BOOKED', label: 'Needs Attention', badge: counts.BOOKED || undefined },
      { id: 'CONFIRMED', label: 'Confirmed', badge: counts.CONFIRMED || undefined },
      { id: 'CHECKED_IN', label: 'Checked In', badge: counts.CHECKED_IN || undefined },
      { id: 'IN_SERVICE', label: 'In Service', badge: counts.IN_SERVICE || undefined },
      { id: 'COMPLETED', label: 'Completed', badge: counts.COMPLETED || undefined },
      { id: 'CLOSED', label: 'Closed / Cancelled', badge: counts.CLOSED || undefined },
    ];
  }, [items]);

  // Prioritized and Filtered items
  const filteredItems = useMemo(() => {
    const prioritized = prioritizeAppointmentNavigation(items, appointmentId);
    return prioritized.filter((item) => {
      if (selectedFilter !== 'ALL') {
        if (selectedFilter === 'CLOSED') {
          if (item.status !== 'CANCELLED' && item.status !== 'REJECTED' && item.status !== 'NO_SHOW') {
            return false;
          }
        } else if (item.status !== selectedFilter) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesPet = item.petName.toLowerCase().includes(q);
        const matchesService = item.serviceName.toLowerCase().includes(q);
        const matchesId = item.appointmentId.toLowerCase().includes(q);
        const matchesNotes = item.notes ? item.notes.toLowerCase().includes(q) : false;
        const matchesPayment = item.paymentStatus.toLowerCase().includes(q);
        return matchesPet || matchesService || matchesId || matchesNotes || matchesPayment;
      }
      return true;
    });
  }, [appointmentId, items, searchQuery, selectedFilter]);

  async function executeTransition(
    appointment: MerchantAppointmentRequest,
    target: MerchantAppointmentStatus,
  ) {
    if (busyId) return;
    setBusyId(appointment.appointmentId);
    setMessage('');
    try {
      const updated = await transitionMerchantAppointment(appointment, target);
      setItems((current) =>
        current.map((item) => (item.appointmentId === updated.appointmentId ? updated : item)),
      );
      Alert.alert(
        'Appointment Updated',
        `${appointment.serviceName} for ${appointment.petName} is now ${appointmentStatusLabel(target)}.`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'State transition failed.';
      const isStale = error instanceof Error && (error.name === 'APPOINTMENT_STATE_INVALID' || error.message.includes('state'));
      if (isStale) {
        Alert.alert(
          'Appointment State Changed',
          'This appointment was updated on another device. Reloading latest server state.',
        );
        try {
          const fresh = await fetchMerchantAppointment(appointment.appointmentId);
          setItems((current) =>
            current.map((item) => (item.appointmentId === fresh.appointmentId ? fresh : item)),
          );
        } catch {
          await load(outletId);
        }
      } else {
        Alert.alert('Transition Failed', errorMsg);
      }
    } finally {
      setBusyId(undefined);
    }
  }

  function handleAppointmentTransition(
    appointment: MerchantAppointmentRequest,
    target: MerchantAppointmentStatus,
  ) {
    if (isOffline) {
      Alert.alert('Offline Mode', 'State transitions require live server connection. Reconnect and retry.');
      return;
    }
    const destructive =
      target === 'REJECTED' || target === 'CANCELLED' || target === 'NO_SHOW' || target === 'COMPLETED';
    if (destructive) {
      setConfirmModalAppointment(appointment);
      setConfirmTarget(target);
      return;
    }
    void executeTransition(appointment, target);
  }

  async function handleConfirmDestructive() {
    if (!confirmModalAppointment || !confirmTarget) return;
    setConfirmLoading(true);
    try {
      await executeTransition(confirmModalAppointment, confirmTarget);
      setConfirmModalAppointment(null);
      setConfirmTarget(null);
    } finally {
      setConfirmLoading(false);
    }
  }

  const moreMenuItems = useMemo(
    () => [
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
        badge: metrics.booked > 0 ? metrics.booked : undefined,
        onPress: () => void refresh(),
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
    ],
    [metrics.booked, pendingCount, refresh],
  );

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
        {/* Operational Summary KPI Bar */}
        <View style={styles.metricsStrip}>
          <MetricCard
            label="Total Scheduled"
            value={metrics.total}
            detail="Today's workload"
            testID="kpi-total-appointments"
            style={styles.metricCard}
          />
          <MetricCard
            label="Needs Action"
            value={metrics.booked}
            detail="Booked requests"
            testID="kpi-booked-appointments"
            accentColor={metrics.booked > 0 ? colors.warning : colors.primary}
            style={metrics.booked > 0 ? { ...styles.metricCard, ...styles.bookedMetricCard } : styles.metricCard}
          />
          <MetricCard
            label="In Service"
            value={metrics.inService}
            detail="Active in salon/clinic"
            testID="kpi-in-service-appointments"
            style={styles.metricCard}
          />
        </View>

        {/* Controls Section: Search & Filters */}
        <View style={styles.controls}>
          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search pet, service, notes, ref…"
            accessibilityLabel="Search appointments"
            testID="appointments-search-input"
          />

          <FilterBar
            options={filterOptions}
            selectedId={selectedFilter}
            onSelect={setSelectedFilter}
            testID="appointments-filter-bar"
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
          <LoadingState message="Loading live appointment workload…" testID="appointments-loading-view" />
        ) : filteredItems.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title="No Scheduled Appointments"
              description="New incoming grooming and veterinary booking requests will appear here for provider management."
              actionTitle="Refresh Schedule"
              onAction={() => void refresh()}
              testID="appointments-empty-state"
            />
          ) : (
            <EmptyState
              title="No Matching Appointments"
              description={`No appointments match the "${selectedFilter}" filter or "${searchQuery}" query.`}
              actionTitle="Clear Filters"
              onAction={() => {
                setSelectedFilter('ALL');
                setSearchQuery('');
              }}
              testID="appointments-filtered-empty-state"
            />
          )
        ) : (
          <View style={styles.appointmentList}>
            {filteredItems.map((appointment) => {
              const isBusy = busyId === appointment.appointmentId;
              const targets = appointmentTargets(appointment);
              const isNavigated = appointmentId === appointment.appointmentId;
              return (
                <AppointmentCard
                  key={appointment.appointmentId}
                  appointment={appointment}
                  availableTargets={targets}
                  onTransition={handleAppointmentTransition}
                  onViewDetails={handleOpenDetail}
                  busy={isBusy}
                  offline={isOffline}
                  navigated={isNavigated}
                  testID={`appointment-card-${appointment.appointmentId}`}
                />
              );
            })}
          </View>
        )}
      </MerchantScreen>

      {/* Appointment Detail Modal */}
      <AppointmentDetailModal
        visible={Boolean(activeDetailAppointment)}
        appointment={activeDetailAppointment}
        availableTargets={activeDetailAppointment ? appointmentTargets(activeDetailAppointment) : []}
        onClose={handleCloseDetail}
        onTransition={handleAppointmentTransition}
        busy={Boolean(busyId && activeDetailAppointment && busyId === activeDetailAppointment.appointmentId)}
        offline={isOffline}
        testID="appointment-detail-modal"
      />

      {/* Destructive Action Confirmation Modal */}
      <ConfirmationModal
        visible={Boolean(confirmModalAppointment && confirmTarget)}
        title={
          confirmTarget === 'REJECTED'
            ? 'Reject Booking Request'
            : confirmTarget === 'CANCELLED'
              ? 'Cancel Appointment'
              : confirmTarget === 'NO_SHOW'
                ? 'Mark as No-Show'
                : 'Complete Appointment'
        }
        message={
          confirmTarget === 'REJECTED'
            ? `Are you sure you want to decline ${confirmModalAppointment?.serviceName} for ${confirmModalAppointment?.petName}? ${
                confirmModalAppointment?.paymentMethod === 'ONLINE_PAYMENT' && confirmModalAppointment?.paymentStatus === 'PAID'
                  ? 'MyPet will initiate the refund workflow.'
                  : ''
              }`
            : confirmTarget === 'CANCELLED'
              ? `Are you sure you want to cancel the appointment for ${confirmModalAppointment?.petName}? This cannot be undone.`
              : confirmTarget === 'NO_SHOW'
                ? `Mark ${confirmModalAppointment?.petName} as No-Show for ${confirmModalAppointment?.serviceName}?`
                : `Confirm completion of ${confirmModalAppointment?.serviceName} for ${confirmModalAppointment?.petName}?`
        }
        confirmLabel={
          confirmTarget === 'REJECTED'
            ? 'Reject Booking'
            : confirmTarget === 'CANCELLED'
              ? 'Cancel Appointment'
              : confirmTarget === 'NO_SHOW'
                ? 'Confirm No-Show'
                : 'Complete Service'
        }
        variant={confirmTarget === 'COMPLETED' ? 'success' : 'destructive'}
        requireReason={confirmTarget === 'REJECTED' || confirmTarget === 'CANCELLED'}
        reasonLabel={
          confirmTarget === 'REJECTED'
            ? 'Reason for declining booking'
            : confirmTarget === 'CANCELLED'
              ? 'Reason for cancellation'
              : undefined
        }
        reasonPlaceholder="e.g. Provider slot conflict, clinic emergency…"
        loading={confirmLoading}
        onConfirm={() => void handleConfirmDestructive()}
        onCancel={() => {
          setConfirmModalAppointment(null);
          setConfirmTarget(null);
        }}
        testID="appointment-confirm-modal"
      />

      <BottomNavigation
        activeTab="orders"
        onTabPress={(tab) => {
          if (tab === 'home') router.push('/dashboard');
          else if (tab === 'inventory') router.push('/inventory');
          else if (tab === 'catalog') router.push('/catalog');
          else if (tab === 'orders') router.push('/orders');
        }}
        orderBadge={metrics.booked > 0 ? metrics.booked : undefined}
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
  metricsStrip: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricCard: {
    flex: 1,
  },
  bookedMetricCard: {
    borderColor: colors.warning,
    borderWidth: 1.5,
    backgroundColor: '#fffdfa',
  },
  controls: {
    gap: spacing.xs,
  },
  noticeBanner: {
    backgroundColor: colors.warningContainer,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  noticeText: {
    ...typography.bodyMd,
    color: colors.onWarningContainer,
    fontWeight: '600',
  },
  appointmentList: {
    gap: spacing.md,
  },
});
