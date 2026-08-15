import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppBar, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { OrderFlowTracker } from '@/components/order-flow-tracker';
import { ThemedText } from '@/components/themed-text';
import { activeOrderPollInterval } from '@/contracts/customer-payment';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { cancelCustomerOrder, fetchCustomerOrderDetail, type CustomerOrderDetail } from '@/services/customer-order-detail';
import { fetchCustomerOrderTracking, type CustomerOrderTracking } from '@/services/customer-delivery';

export default function OrderDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const [order, setOrder] = useState<CustomerOrderDetail | null>(null);
  const [tracking, setTracking] = useState<CustomerOrderTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadOrder = useCallback(async (showLoading = false) => {
    if (!id || !session) return;
    if (showLoading) setLoading(true);
    try {
      const nextOrder = await fetchCustomerOrderDetail(id, session.accessToken);
      setOrder(nextOrder);
      if (nextOrder.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY') {
        setTracking(await fetchCustomerOrderTracking(id, session.accessToken));
      } else {
        setTracking(null);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load order details');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [id, session]);

  useEffect(() => { void loadOrder(true); }, [loadOrder]);

  useEffect(() => {
    if (!order) return;
    const interval = activeOrderPollInterval(order.status);
    if (!interval) return;
    const timer = setInterval(() => void loadOrder(false), interval);
    return () => clearInterval(timer);
  }, [loadOrder, order]);

  const handleCancel = async () => {
    if (!order || !session || actionLoading) return;
    setActionLoading(true);
    try {
      const nextOrder = await cancelCustomerOrder(
        order.orderId,
        'Cancelled from customer order detail',
        session.accessToken,
      );
      setOrder(nextOrder);
      setTracking(nextOrder.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY'
        ? await fetchCustomerOrderTracking(nextOrder.orderId, session.accessToken)
        : null);
      Alert.alert(t('common.success'), 'Order cancelled successfully.');
    } catch (cause) {
      Alert.alert(t('common.error'), cause instanceof Error ? cause.message : 'Could not cancel order.');
    } finally {
      setActionLoading(false);
    }
  };

  const isDelivery = order?.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY';
  const subtitle = isDelivery ? 'MyPet Captain delivery · Pay on fulfilment' : 'Store pickup · Pay on fulfilment';

  return (
    <ScreenShell
      header={(
        <AppBar
          title={`Order #${order?.orderNumber ?? id?.slice(0, 8) ?? ''}`}
          subtitle={subtitle}
          action={(
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ThemedText style={{ color: theme.text, fontWeight: '700' }}>✕</ThemedText>
            </Pressable>
          )}
        />
      )}
    >
      {!session ? (
        <StateView kind="unauthenticated" title={t('states.unauthenticated')} message="Sign in to view this order." />
      ) : loading ? (
        <StateView kind="loading" title={t('states.loading')} message="Loading the server-authoritative order…" />
      ) : error || !order ? (
        <StateView
          kind="error"
          title={t('states.error')}
          message={error || 'Order not found'}
          actionLabel={t('states.retry')}
          onAction={() => void loadOrder(true)}
        />
      ) : (
        <View style={styles.container}>
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <ThemedText style={styles.storeName}>{order.outletName}</ThemedText>
                {order.placedAt ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Placed {new Date(order.placedAt).toLocaleString()}
                  </ThemedText>
                ) : null}
              </View>
              <StatusBadge
                label={order.status.replaceAll('_', ' ')}
                tone={order.status === 'DELIVERED'
                  ? 'success'
                  : order.status === 'CANCELLED' || order.status === 'REJECTED'
                    ? 'error'
                    : 'warning'}
              />
            </View>
            <ThemedText style={styles.sectionTitle}>{isDelivery ? 'Delivery progress' : 'Pickup progress'}</ThemedText>
            <View style={[styles.trackerBox, { backgroundColor: theme.primarySoft }]}>
              <OrderFlowTracker status={order.status} />
            </View>
            {activeOrderPollInterval(order.status) ? (
              <ThemedText type="small" themeColor="textSecondary">
                Refreshing automatically while this order is active.
              </ThemedText>
            ) : null}
          </View>

          {isDelivery ? (
            <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.row}>
                <ThemedText style={styles.sectionTitle}>Captain tracking</ThemedText>
                <StatusBadge label={(tracking?.deliveryStatus ?? 'SEARCHING').replaceAll('_', ' ')} tone="warning" />
              </View>
              {tracking?.captain ? (
                <>
                  <DetailRow label="Captain" value={`Assigned · ${tracking.captain.captainId.slice(0, 8)}`} />
                  {tracking.captain.assignedAt ? (
                    <DetailRow label="Assigned" value={new Date(tracking.captain.assignedAt).toLocaleTimeString()} />
                  ) : null}
                </>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  MyPet is searching for an eligible nearby Captain after the merchant marks the order ready.
                </ThemedText>
              )}
              {tracking?.etaMinutes ? <DetailRow label="Server ETA" value={`About ${tracking.etaMinutes} min`} /> : null}
              {tracking?.lastLocation ? (
                <View style={[styles.locationBox, { backgroundColor: theme.primarySoft }]}>
                  <ThemedText type="smallBold">Captain location is live</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Updated {new Date(tracking.lastLocation.observedAt).toLocaleTimeString()} · {tracking.lastLocation.latitude.toFixed(4)}, {tracking.lastLocation.longitude.toFixed(4)}
                  </ThemedText>
                </View>
              ) : null}
              {order.status === 'DELIVERED' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Live Captain location is no longer shared after delivery completion.
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.sectionTitle}>Order items</ThemedText>
            {order.items.map((item) => (
              <View key={item.listingId} style={styles.itemRow}>
                <View style={styles.flex}>
                  <ThemedText style={styles.itemName}>{item.name ?? `Item ${item.listingId.slice(0, 8)}`}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Qty {item.quantity}</ThemedText>
                </View>
              </View>
            ))}
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.row}>
              <ThemedText style={styles.totalLabel}>Server order total</ThemedText>
              <ThemedText style={[styles.totalValue, { color: theme.primary }]}>₹{(order.grandTotalPaise / 100).toFixed(2)}</ThemedText>
            </View>
          </View>

          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.sectionTitle}>Fulfilment & payment</ThemedText>
            <DetailRow label="Fulfilment" value={isDelivery ? 'MyPet Captain delivery' : 'Store pickup'} />
            <DetailRow label="Payment" value="Pay on fulfilment" />
            <DetailRow label="Payment status" value={order.paymentStatus.replaceAll('_', ' ')} />
          </View>

          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.sectionTitle}>Status history</ThemedText>
            {order.statusHistory.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No status events are available yet.</ThemedText>
            ) : order.statusHistory.map((entry, index) => (
              <View key={`${entry.toStatus}-${entry.changedAt}-${index}`} style={styles.historyRow}>
                <ThemedText style={{ fontWeight: '700' }}>{entry.toStatus.replaceAll('_', ' ')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(entry.changedAt).toLocaleString()}{entry.reason ? ` · ${entry.reason}` : ''}
                </ThemedText>
              </View>
            ))}
          </View>

          {order.status === 'PLACED' ? (
            <Pressable
              style={[styles.cancelButton, { borderColor: theme.danger }, actionLoading && styles.disabled]}
              onPress={() => void handleCancel()}
              disabled={actionLoading}
            >
              <ThemedText style={{ color: theme.danger, fontWeight: '700' }}>
                {actionLoading ? 'Cancelling…' : 'Cancel order'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScreenShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backButton: { padding: spacing.x2 },
  container: { padding: spacing.x4, gap: spacing.x4, paddingBottom: spacing.x8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2 },
  storeName: { ...typography.title },
  sectionTitle: { ...typography.label, fontWeight: '700' },
  trackerBox: { padding: spacing.x3, borderRadius: radii.compact },
  locationBox: { padding: spacing.x3, borderRadius: radii.compact, gap: spacing.x1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x1 },
  itemName: { ...typography.body, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.x1 },
  totalLabel: { ...typography.label },
  totalValue: { ...typography.title, fontWeight: '800' },
  historyRow: { gap: spacing.x1, paddingVertical: spacing.x1 },
  cancelButton: { height: 48, borderWidth: 1, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.6 },
});
