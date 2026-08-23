import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { decideAppointmentRequest, fetchPendingAppointmentRequests, MerchantAppointmentRequest } from '../../src/appointments/api';
import { bypassMerchantLoginForDemo, hasRuntimeMerchantSession, logoutMerchant, restoreMerchantSession } from '../../src/auth/session';
import { MerchantHeader } from '../../src/components/MerchantHeader';
import { MetricCard } from '../../src/components/MetricCard';
import { ScreenShell } from '../../src/components/ScreenShell';
import { StatusBadge } from '../../src/components/StatusBadge';
import { palette, radii, spacing, touchTarget, typography } from '../../src/design/tokens';
import { fetchMerchantOrders, MerchantOrderSummary, transitionOrderStatus } from '../../src/orders/api';

export default function MerchantDashboardScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAppointments, setPendingAppointments] = useState<MerchantAppointmentRequest[]>([]);
  const [liveOrders, setLiveOrders] = useState<MerchantOrderSummary[]>([]);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const loadDashboardData = useCallback(async (isRefresh = false) => {
    if (!hasRuntimeMerchantSession()) {
      const restored = await restoreMerchantSession().catch(() => false);
      if (!restored) {
        await bypassMerchantLoginForDemo().catch(() => null);
      }
    }

    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [appts, orders] = await Promise.all([
        fetchPendingAppointmentRequests().catch(() => []),
        fetchMerchantOrders('demo-outlet-1').catch(() => []),
      ]);
      setPendingAppointments(appts);
      setLiveOrders(orders);
    } catch {
      // Retain last known state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const handleAcceptAppointment = async (request: MerchantAppointmentRequest) => {
    setActionBusyId(request.appointmentId);
    try {
      await decideAppointmentRequest(request, 'CONFIRMED');
      setPendingAppointments((prev) => prev.filter((a) => a.appointmentId !== request.appointmentId));
      Alert.alert('Booking Confirmed', `Confirmed ${request.serviceName} for ${request.petName}.`);
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDeclineAppointment = async (request: MerchantAppointmentRequest) => {
    setActionBusyId(request.appointmentId);
    try {
      await decideAppointmentRequest(request, 'REJECTED');
      setPendingAppointments((prev) => prev.filter((a) => a.appointmentId !== request.appointmentId));
      Alert.alert(
        'Booking Declined',
        request.paymentMethod === 'ONLINE_PAYMENT' && request.paymentStatus === 'PAID'
          ? `Booking declined. An automated online refund has been initiated for the customer.`
          : `Booking request declined.`,
      );
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleMarkOrderReady = async (order: MerchantOrderSummary) => {
    setActionBusyId(order.orderId);
    try {
      await transitionOrderStatus(order.orderId, 'READY_FOR_PICKUP', 'Ready at store counter', `ready-${Date.now()}`);
      setLiveOrders((prev) =>
        prev.map((o) => (o.orderId === order.orderId ? { ...o, status: 'READY_FOR_PICKUP' } : o)),
      );
      Alert.alert('Order Updated', `Order ${order.displayNumber} is now ready for customer pickup.`);
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of your Merchant account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logoutMerchant().catch(() => null);
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <ScreenShell header={<MerchantHeader />}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadDashboardData(true)} />}
      >
        {/* Quick Summary Metrics Grid */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's Operational Pulse</Text>
          <Pressable onPress={handleSignOut} accessibilityRole="button">
            <Text style={styles.signOutLink}>Sign Out</Text>
          </Pressable>
        </View>

        <View style={styles.metricsGrid}>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Today's POS Sales"
              value="₹28,450"
              subValue="16 in-store bills"
              accentColor={palette.royalBlue}
            />
            <MetricCard
              label="Online Orders"
              value={`${liveOrders.length || 8} Orders`}
              subValue="2 Pending Prep"
              accentColor={palette.emerald}
            />
          </View>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Care Bookings"
              value={`${pendingAppointments.length || 3} Pending`}
              subValue="Awaiting acceptance"
              accentColor={palette.amber}
            />
            <MetricCard
              label="Loyalty Stars"
              value="34 Stars"
              subValue="Awarded today"
              accentColor={palette.amber}
            />
          </View>
        </View>

        {/* Quick Action Navigation Grid */}
        <View style={styles.quickActionsContainer}>
          <Pressable
            style={styles.primaryActionButton}
            onPress={() => router.push('/pos' as any)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryActionIcon}>⚡</Text>
            <View>
              <Text style={styles.primaryActionTitle}>Quick POS Scan / Bill</Text>
              <Text style={styles.primaryActionSub}>Scan barcodes & collect payments</Text>
            </View>
          </Pressable>

          <View style={styles.secondaryActionsRow}>
            <Pressable
              style={styles.secondaryActionCard}
              onPress={() => router.push('/inventory' as any)}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryActionIcon}>📦</Text>
              <Text style={styles.secondaryActionLabel}>Stock In / Receive</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryActionCard}
              onPress={() => router.push('/appointments' as any)}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryActionIcon}>🐾</Text>
              <Text style={styles.secondaryActionLabel}>Care Schedule</Text>
            </Pressable>
          </View>
        </View>

        {/* Live Urgent Bookings Feed */}
        <View style={styles.feedSection}>
          <View style={styles.feedHeaderRow}>
            <Text style={styles.feedTitle}>Urgent Booking Requests</Text>
            <StatusBadge status="NEW_REQUEST" label={`${pendingAppointments.length} PENDING`} />
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loader} color={palette.royalBlue} />
          ) : pendingAppointments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>All care bookings have been reviewed!</Text>
            </View>
          ) : (
            pendingAppointments.slice(0, 2).map((request) => {
              const isBusy = actionBusyId === request.appointmentId;
              const isOnlinePaid = request.paymentMethod === 'ONLINE_PAYMENT' && request.paymentStatus === 'PAID';
              return (
                <View key={request.appointmentId} style={styles.actionCard}>
                  <View style={styles.cardTop}>
                    <View style={styles.petAvatar}>
                      <Text style={styles.avatarIcon}>🐶</Text>
                    </View>
                    <View style={styles.cardDetails}>
                      <Text style={styles.cardTitle}>{request.serviceName}</Text>
                      <Text style={styles.cardSubtitle}>Pet: {request.petName}</Text>
                    </View>
                    <StatusBadge
                      status={isOnlinePaid ? 'PAID_ONLINE' : 'PAY_AT_CLINIC'}
                      label={isOnlinePaid ? 'PAID ONLINE' : 'PAY AT CLINIC'}
                    />
                  </View>

                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleText}>
                      📅 {new Date(request.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ₹
                      {(request.pricePaise / 100).toFixed(0)}
                    </Text>
                  </View>

                  {request.notes ? <Text style={styles.notesBox}>Note: {request.notes}</Text> : null}

                  <View style={styles.cardActions}>
                    <Pressable
                      style={[styles.declineButton, isBusy && styles.disabledBtn]}
                      disabled={isBusy}
                      onPress={() => void handleDeclineAppointment(request)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.acceptButton, isBusy && styles.disabledBtn]}
                      disabled={isBusy}
                      onPress={() => void handleAcceptAppointment(request)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.acceptBtnText}>{isBusy ? 'Updating…' : 'Accept Booking'}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Live Orders Feed */}
        <View style={styles.feedSection}>
          <View style={styles.feedHeaderRow}>
            <Text style={styles.feedTitle}>Live Store Pickup & Delivery</Text>
            <Pressable onPress={() => router.push('/orders' as any)}>
              <Text style={styles.viewAllLink}>View All ({liveOrders.length})</Text>
            </Pressable>
          </View>

          {liveOrders.length === 0 ? (
            <View style={styles.actionCard}>
              <View style={styles.cardTop}>
                <View style={styles.cardDetails}>
                  <Text style={styles.cardTitle}>Order #MP-4921</Text>
                  <Text style={styles.cardSubtitle}>2x Pedigree Pro 3kg + Dog Chew Treats</Text>
                </View>
                <StatusBadge status="PREPARING" label="PREPARING" />
              </View>
              <Text style={styles.scheduleText}>💰 Total: ₹2,450 · Store Pickup</Text>
              <Pressable
                style={styles.acceptButton}
                onPress={() => Alert.alert('Order Updated', 'Marked ready for customer pickup.')}
                accessibilityRole="button"
              >
                <Text style={styles.acceptBtnText}>Mark Ready for Pickup</Text>
              </Pressable>
            </View>
          ) : (
            liveOrders.slice(0, 2).map((order) => (
              <View key={order.orderId} style={styles.actionCard}>
                <View style={styles.cardTop}>
                  <View style={styles.cardDetails}>
                    <Text style={styles.cardTitle}>{order.displayNumber}</Text>
                    <Text style={styles.cardSubtitle}>
                      {order.lines.map((l) => `${l.quantity}x ${l.name}`).join(', ')}
                    </Text>
                  </View>
                  <StatusBadge status={order.status as any} />
                </View>
                <Text style={styles.scheduleText}>
                  💰 ₹{(order.totalPaise / 100).toFixed(0)} ·{' '}
                  {order.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' ? 'Captain Delivery' : 'Store Pickup'}
                </Text>
                {order.status === 'PREPARING' || order.status === 'PLACED' ? (
                  <Pressable
                    style={styles.acceptButton}
                    onPress={() => void handleMarkOrderReady(order)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.acceptBtnText}>Mark Ready for Pickup</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: spacing.x4, gap: spacing.x5, paddingBottom: spacing.x8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...typography.headline, color: palette.ink },
  signOutLink: { ...typography.label, color: palette.error },
  metricsGrid: { gap: spacing.x3 },
  metricsRow: { flexDirection: 'row', gap: spacing.x3 },
  quickActionsContainer: { gap: spacing.x3 },
  primaryActionButton: {
    minHeight: 64,
    backgroundColor: palette.royalBlue,
    borderRadius: radii.card,
    padding: spacing.x4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x4,
  },
  primaryActionIcon: { fontSize: 28 },
  primaryActionTitle: { ...typography.title, color: palette.white },
  primaryActionSub: { ...typography.bodySmall, color: palette.royalBlueSoft },
  secondaryActionsRow: { flexDirection: 'row', gap: spacing.x3 },
  secondaryActionCard: {
    flex: 1,
    minHeight: touchTarget,
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.x3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x1,
  },
  secondaryActionIcon: { fontSize: 20 },
  secondaryActionLabel: { ...typography.label, color: palette.ink },
  feedSection: { gap: spacing.x3 },
  feedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feedTitle: { ...typography.title, color: palette.ink },
  viewAllLink: { ...typography.label, color: palette.royalBlue },
  actionCard: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  petAvatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: palette.coolWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: { fontSize: 24 },
  cardDetails: { flex: 1 },
  cardTitle: { ...typography.title, fontSize: 16, color: palette.ink },
  cardSubtitle: { ...typography.bodySmall, color: palette.inkMuted },
  scheduleRow: { backgroundColor: palette.coolWhite, padding: spacing.x2, borderRadius: radii.xs },
  scheduleText: { ...typography.bodySmall, fontWeight: '600', color: palette.ink },
  notesBox: {
    backgroundColor: palette.amberSoft,
    padding: spacing.x2,
    borderRadius: radii.xs,
    color: '#92400E',
    ...typography.bodySmall,
  },
  cardActions: { flexDirection: 'row', gap: spacing.x2 },
  declineButton: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: { ...typography.label, color: palette.error, fontWeight: '700' },
  acceptButton: {
    flex: 2,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtnText: { ...typography.label, color: palette.white, fontWeight: '700' },
  disabledBtn: { opacity: 0.5 },
  emptyCard: {
    backgroundColor: palette.white,
    padding: spacing.x6,
    borderRadius: radii.card,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  emptyText: { ...typography.body, color: palette.inkMuted },
  loader: { padding: spacing.x6 },
});
