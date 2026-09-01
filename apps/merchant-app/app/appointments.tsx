import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
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

const APPOINTMENT_PAGE_SIZE = 50;
const CLOSED_STATUSES = new Set<MerchantAppointmentStatus>(['CANCELLED', 'REJECTED', 'NO_SHOW']);

function isNetworkError(error: unknown): boolean {
  return error instanceof Error && /network|fetch|offline|failed to fetch/i.test(error.message);
}

function isSameLocalDay(value: string, reference: Date): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

function mergeAppointments(
  current: MerchantAppointmentRequest[],
  incoming: MerchantAppointmentRequest[],
): MerchantAppointmentRequest[] {
  const merged = new Map(current.map((item) => [item.appointmentId, item]));
  incoming.forEach((item) => merged.set(item.appointmentId, item));
  return [...merged.values()];
}

export default function MerchantAppointmentsScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();

  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [items, setItems] = useState<MerchantAppointmentRequest[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<AppointmentFilterStatus>('ALL');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const [manualSelectedId, setManualSelectedId] = useState<string | null>(null);
  const [dismissedDeepLinkId, setDismissedDeepLinkId] = useState<string | null>(null);
  const [confirmModalAppointment, setConfirmModalAppointment] = useState<MerchantAppointmentRequest | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<MerchantAppointmentStatus | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const lastSuccessfulOutletRef = useRef<string | undefined>(undefined);
  const requestSequenceRef = useRef(0);
  const resolvedDeepLinkRef = useRef<string | undefined>(undefined);

  const activeAppointmentId = appointmentId && dismissedDeepLinkId !== appointmentId ? appointmentId : manualSelectedId;
  const activeDetailAppointment = useMemo(() => {
    if (!activeAppointmentId) return null;
    return items.find((item) => item.appointmentId === activeAppointmentId) ?? null;
  }, [activeAppointmentId, items]);

  const handleOpenDetail = useCallback((appointment: MerchantAppointmentRequest) => {
    setManualSelectedId(appointment.appointmentId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setManualSelectedId(null);
    if (appointmentId) setDismissedDeepLinkId(appointmentId);
  }, [appointmentId]);

  const load = useCallback(async (
    context: MerchantCatalogContext,
    selectedOutlet: string | undefined,
    targetPage = 0,
    append = false,
  ) => {
    const requestSequence = ++requestSequenceRef.current;
    if (!append) setMessage('');

    if (!hasRuntimeMerchantSession()) {
      if (!append) setItems([]);
      setHasNext(false);
      return;
    }
    const scopeKey = selectedOutlet ?? '__ALL_OUTLETS__';

    try {
      const page = await fetchMerchantAppointments({
        outletId: selectedOutlet,
        page: targetPage,
        pageSize: APPOINTMENT_PAGE_SIZE,
      });
      if (requestSequence !== requestSequenceRef.current) return;

      setItems((current) => append ? mergeAppointments(current, page.items) : page.items);
      setNextPage(targetPage + 1);
      setHasNext(page.hasNext);
      setIsOffline(false);
      lastSuccessfulOutletRef.current = scopeKey;

      if (outboxRepo && syncStateRepo && context.organizationId) {
        try {
          const accountId = await loadOfflineMerchantAccountId();
          if (accountId) {
            const organizationId = context.organizationId;
            const scopedOutletIds = selectedOutlet ? [selectedOutlet] : context.outletIds;
            const partitions = scopedOutletIds.map((id) => createPartitionContext(accountId, organizationId, id));
            const summary = await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo);
            if (requestSequence === requestSequenceRef.current) setSync(summary);
          }
        } catch {
          if (requestSequence === requestSequenceRef.current) setSync(undefined);
        }
      }
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      if (isNetworkError(error)) {
        const hasSessionDataForOutlet = lastSuccessfulOutletRef.current === scopeKey;
        setIsOffline(true);
        setHasNext(false);
        if (!hasSessionDataForOutlet) setItems([]);
        setMessage(
          hasSessionDataForOutlet
            ? 'Offline: showing the last appointment data loaded for this outlet in this session.'
            : 'Offline: no appointment cache is available for this outlet scope on this device.',
        );
      } else {
        if (!append) setItems([]);
        setHasNext(false);
        setMessage(error instanceof Error ? error.message : 'Appointments workload is currently unavailable.');
      }
    }
  }, [outboxRepo, syncStateRepo]);

  const refresh = useCallback(async () => {
    if (!merchantContext) return;
    setRefreshing(true);
    try {
      await load(merchantContext, outletId, 0, false);
    } finally {
      setRefreshing(false);
    }
  }, [load, merchantContext, outletId]);

  const loadMore = useCallback(async () => {
    if (!merchantContext || !hasNext || loadingMore || isOffline) return;
    setLoadingMore(true);
    try {
      await load(merchantContext, outletId, nextPage, true);
    } finally {
      setLoadingMore(false);
    }
  }, [hasNext, isOffline, load, loadingMore, merchantContext, nextPage, outletId]);

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
        await load(context, initialOutlet, 0, false);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Appointments unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      requestSequenceRef.current += 1;
    };
  }, [load]);


  useEffect(() => {
    if (!appointmentId || !merchantContext || dismissedDeepLinkId === appointmentId) return;
    if (items.some((item) => item.appointmentId === appointmentId)) return;
    if (resolvedDeepLinkRef.current === appointmentId) return;
    resolvedDeepLinkRef.current = appointmentId;

    let active = true;
    void (async () => {
      try {
        const appointment = await fetchMerchantAppointment(appointmentId);
        if (!active) return;
        if (!merchantContext.outletIds.includes(appointment.outletId)) {
          setMessage('This appointment is not available in your current merchant outlet scope.');
          return;
        }
        setOutletId(appointment.outletId);
        setLoading(true);
        await load(merchantContext, appointment.outletId, 0, false);
        if (!active) return;
        setItems((current) => current.some((item) => item.appointmentId === appointment.appointmentId)
          ? current
          : [appointment, ...current]);
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'The linked appointment is unavailable.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [appointmentId, dismissedDeepLinkId, items, load, merchantContext]);

  const outletOptions = useMemo(() => {
    if (!merchantContext) return [];
    return merchantContext.outletIds.map((id, index) => ({
      id,
      name: `Outlet ${index + 1} (${id.slice(0, 8)})`,
    }));
  }, [merchantContext]);

  const currentOutletName = useMemo(() => {
    if (!outletId) return 'All Outlets';
    const found = outletOptions.find((option) => option.id === outletId);
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
    if (!merchantContext) return;
    setOutletId(selected);
    setItems([]);
    setSync(undefined);
    setHasNext(false);
    setLoading(true);
    void (async () => {
      try {
        await load(merchantContext, selected, 0, false);
      } finally {
        setLoading(false);
      }
    })();
  }

  const metrics = useMemo(() => {
    const today = new Date();
    let todayScheduled = 0;
    let booked = 0;
    let inService = 0;
    let completed = 0;
    items.forEach((item) => {
      if (isSameLocalDay(item.startsAt, today) && !CLOSED_STATUSES.has(item.status)) todayScheduled += 1;
      if (item.status === 'BOOKED') booked += 1;
      else if (item.status === 'IN_SERVICE' || item.status === 'CHECKED_IN') inService += 1;
      else if (item.status === 'COMPLETED') completed += 1;
    });
    return { todayScheduled, booked, inService, completed };
  }, [items]);

  const filterOptions: FilterOption<AppointmentFilterStatus>[] = useMemo(() => {
    const counts: Record<AppointmentFilterStatus, number> = {
      ALL: items.length,
      BOOKED: 0,
      CONFIRMED: 0,
      CHECKED_IN: 0,
      IN_SERVICE: 0,
      COMPLETED: 0,
      CLOSED: 0,
    };
    items.forEach((item) => {
      if (item.status in counts) counts[item.status as AppointmentFilterStatus] += 1;
      if (CLOSED_STATUSES.has(item.status)) counts.CLOSED += 1;
    });
    return [
      { id: 'ALL', label: 'All Loaded', badge: counts.ALL || undefined },
      { id: 'BOOKED', label: 'Needs Attention', badge: counts.BOOKED || undefined },
      { id: 'CONFIRMED', label: 'Confirmed', badge: counts.CONFIRMED || undefined },
      { id: 'CHECKED_IN', label: 'Checked In', badge: counts.CHECKED_IN || undefined },
      { id: 'IN_SERVICE', label: 'In Service', badge: counts.IN_SERVICE || undefined },
      { id: 'COMPLETED', label: 'Completed', badge: counts.COMPLETED || undefined },
      { id: 'CLOSED', label: 'Closed / Cancelled', badge: counts.CLOSED || undefined },
    ];
  }, [items]);

  const filteredItems = useMemo(() => {
    const prioritized = prioritizeAppointmentNavigation(items, appointmentId);
    return prioritized.filter((item) => {
      if (selectedFilter !== 'ALL') {
        if (selectedFilter === 'CLOSED') {
          if (!CLOSED_STATUSES.has(item.status)) return false;
        } else if (item.status !== selectedFilter) {
          return false;
        }
      }
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return item.petName.toLowerCase().includes(q)
        || item.serviceName.toLowerCase().includes(q)
        || item.appointmentId.toLowerCase().includes(q)
        || Boolean(item.notes?.toLowerCase().includes(q))
        || item.paymentStatus.toLowerCase().includes(q);
    });
  }, [appointmentId, items, searchQuery, selectedFilter]);

  async function executeTransition(
    appointment: MerchantAppointmentRequest,
    target: MerchantAppointmentStatus,
    reason?: string,
  ) {
    if (busyId) return;
    setBusyId(appointment.appointmentId);
    setMessage('');
    try {
      const updated = await transitionMerchantAppointment(appointment, target, reason);
      setItems((current) => current.map((item) => item.appointmentId === updated.appointmentId ? updated : item));
      Alert.alert(
        'Appointment Updated',
        `${appointment.serviceName} for ${appointment.petName} is now ${appointmentStatusLabel(updated.status)}.`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'State transition failed.';
      const stale = error instanceof Error && error.name === 'APPOINTMENT_STATE_INVALID';
      if (stale) {
        Alert.alert(
          'Appointment State Changed',
          'This appointment was updated on another device. Reloading the latest server state.',
        );
        try {
          const fresh = await fetchMerchantAppointment(appointment.appointmentId);
          setItems((current) => current.map((item) => item.appointmentId === fresh.appointmentId ? fresh : item));
        } catch {
          if (merchantContext && outletId) await load(merchantContext, outletId, 0, false);
        }
      } else {
        Alert.alert('Transition Failed', errorMessage);
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
      Alert.alert('Offline Mode', 'State transitions require a live server connection. Reconnect and retry.');
      return;
    }
    const requiresConfirmation = target === 'REJECTED'
      || target === 'CANCELLED'
      || target === 'NO_SHOW'
      || target === 'COMPLETED';
    if (requiresConfirmation) {
      setConfirmModalAppointment(appointment);
      setConfirmTarget(target);
      return;
    }
    void executeTransition(appointment, target);
  }

  async function handleConfirmDestructive(reason?: string) {
    if (!confirmModalAppointment || !confirmTarget) return;
    setConfirmLoading(true);
    try {
      await executeTransition(confirmModalAppointment, confirmTarget, reason);
      setConfirmModalAppointment(null);
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
  ], [metrics.booked, pendingCount, refresh]);

  const listHeader = (
    <View style={styles.listHeader}>
      <View style={styles.metricsStrip}>
        <MetricCard
          label="Today"
          value={metrics.todayScheduled}
          detail="Visible schedule"
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

      <View style={styles.controls}>
        <SearchInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search pet, service, notes, ref…"
          accessibilityLabel="Search loaded appointments"
          testID="appointments-search-input"
        />
        <FilterBar
          options={filterOptions}
          selectedId={selectedFilter}
          onSelect={setSelectedFilter}
          testID="appointments-filter-bar"
        />
      </View>

      {message ? (
        <View style={styles.noticeBanner}>
          <Text accessibilityRole="alert" style={styles.noticeText}>{message}</Text>
        </View>
      ) : null}
    </View>
  );

  const emptyState = loading ? (
    <LoadingState message="Loading live appointment workload…" testID="appointments-loading-view" />
  ) : items.length === 0 ? (
    <EmptyState
      title={isOffline ? 'Appointments Unavailable Offline' : 'No Scheduled Appointments'}
      description={
        isOffline
          ? 'No appointment data has been loaded for this outlet scope in the current session. Reconnect to refresh.'
          : 'New incoming grooming and veterinary booking requests will appear here for provider management.'
      }
      actionTitle="Refresh Schedule"
      onAction={() => void refresh()}
      testID="appointments-empty-state"
    />
  ) : (
    <EmptyState
      title="No Matching Appointments"
      description={`No loaded appointments match the "${selectedFilter}" filter or "${searchQuery}" query.`}
      actionTitle="Clear Filters"
      onAction={() => {
        setSelectedFilter('ALL');
        setSearchQuery('');
      }}
      testID="appointments-filtered-empty-state"
    />
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
        scrollable={false}
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
        contentContainerStyle={styles.screenContent}
      >
        <FlatList
          data={loading ? [] : filteredItems}
          keyExtractor={(appointment) => appointment.appointmentId}
          renderItem={({ item: appointment }) => (
            <AppointmentCard
              appointment={appointment}
              availableTargets={appointmentTargets(appointment)}
              onTransition={handleAppointmentTransition}
              onViewDetails={handleOpenDetail}
              busy={busyId === appointment.appointmentId}
              offline={isOffline}
              navigated={appointmentId === appointment.appointmentId}
              testID={`appointment-card-${appointment.appointmentId}`}
            />
          )}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyState}
          ListFooterComponent={loadingMore ? <LoadingState message="Loading more appointments…" /> : null}
          ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          initialNumToRender={10}
          windowSize={7}
          testID="appointments-list"
        />
      </MerchantScreen>

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

      <ConfirmationModal
        key={`${confirmModalAppointment?.appointmentId ?? 'none'}:${confirmTarget ?? 'none'}`}
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
        onConfirm={(reason) => void handleConfirmDestructive(reason)}
        onCancel={() => {
          setConfirmModalAppointment(null);
          setConfirmTarget(null);
        }}
        testID="appointment-confirm-modal"
      />

      <BottomNavigation
        activeTab="more"
        onTabPress={(tab) => {
          if (tab === 'home') router.push('/dashboard');
          else if (tab === 'inventory') router.push('/inventory');
          else if (tab === 'catalog') router.push('/catalog');
          else if (tab === 'orders') router.push('/orders');
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
  screenContent: {
    padding: 0,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  listHeader: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  itemSeparator: {
    height: spacing.md,
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
});
