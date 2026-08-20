import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppBar, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { OrderFlowTracker } from '@/components/order-flow-tracker';
import { ThemedText } from '@/components/themed-text';
import { activeOrderPollInterval } from '@/contracts/customer-payment';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { ApiError, apiClient } from '@/services/api-client';
import { cancelCustomerOrder, fetchCustomerOrderDetail, type CustomerOrderDetail } from '@/services/customer-order-detail';
import { fetchCustomerOrderTracking, type CustomerOrderTracking } from '@/services/customer-delivery';
import { isOfflineError } from '@/services/customer-profile';
import { isUuid } from '@/utils/uuid';

type DetailErrorKind = 'offline' | 'notFound' | 'error';

function paymentMethodLabel(method: CustomerOrderDetail['paymentMethod']): string {
  return method === 'ONLINE_PAYMENT' ? 'Online payment' : 'Pay on fulfilment';
}

function paise(value: number): string {
  return `₹${(value / 100).toFixed(2)}`;
}

function negativePaise(value: number): string {
  return `−${paise(value)}`;
}

export default function OrderDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const [order, setOrder] = useState<CustomerOrderDetail | null>(null);
  const [tracking, setTracking] = useState<CustomerOrderTracking | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<DetailErrorKind>('error');
  const [actionLoading, setActionLoading] = useState(false);
  const requestGenerationRef = useRef(0);

  const loadOrder = useCallback(async (showLoading = false) => {
    if (!id || !accessToken) return;
    const generation = ++requestGenerationRef.current;
    const authEpoch = apiClient.getAuthEpoch();
    const current = () => generation === requestGenerationRef.current && authEpoch === apiClient.getAuthEpoch();

    if (!isUuid(id)) {
      setOrder(null);
      setTracking(null);
      setTrackingError(null);
      setError('This order link is invalid.');
      setErrorKind('notFound');
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const nextOrder = await fetchCustomerOrderDetail(id, accessToken);
      if (!current()) return;
      setOrder(nextOrder);
      setError(null);
      setTrackingError(null);

      if (nextOrder.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY') {
        try {
          const nextTracking = await fetchCustomerOrderTracking(id, accessToken);
          if (!current()) return;
          setTracking(nextTracking);
        } catch (cause) {
          if (!current()) return;
          setTracking(null);
          setTrackingError(isOfflineError(cause)
            ? 'Delivery tracking is unavailable while offline. The persisted order detail above is still valid.'
            : 'Delivery tracking is temporarily unavailable. Refresh to retry without losing order details.');
        }
      } else {
        setTracking(null);
      }
    } catch (cause) {
      if (!current()) return;
      setOrder(null);
      setTracking(null);
      setTrackingError(null);
      setError(cause instanceof Error ? cause.message : 'Could not load order details');
      if (isOfflineError(cause)) setErrorKind('offline');
      else if (cause instanceof ApiError && cause.status === 404) setErrorKind('notFound');
      else setErrorKind('error');
    } finally {
      if (current() && showLoading) setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    if (!accessToken) {
      requestGenerationRef.current += 1;
      setOrder(null);
      setTracking(null);
      setTrackingError(null);
      setLoading(false);
      return;
    }
    void loadOrder(true);
    return () => { requestGenerationRef.current += 1; };
  }, [accessToken, loadOrder]);

  useEffect(() => {
    if (!order) return;
    const interval = activeOrderPollInterval(order.status);
    if (!interval) return;
    const timer = setInterval(() => void loadOrder(false), interval);
    return () => clearInterval(timer);
  }, [loadOrder, order?.status]);

  const handleCancel = async () => {
    if (!order || !accessToken || actionLoading || !order.canCancel) return;
    setActionLoading(true);
    try {
      await cancelCustomerOrder(order.orderId, 'Cancelled from customer order detail', accessToken);
      await loadOrder(false);
      Alert.alert(t('common.success'), 'Order cancelled successfully.');
    } catch (cause) {
      Alert.alert(t('common.error'), cause instanceof Error ? cause.message : 'Could not cancel order.');
      await loadOrder(false);
    } finally {
      setActionLoading(false);
    }
  };

  const isDelivery = order?.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY';
  const subtitle = order
    ? `${isDelivery ? 'MyPet Captain delivery' : 'Store pickup'} · ${paymentMethodLabel(order.paymentMethod)}`
    : undefined;

  return (
    <ScreenShell
      header={(
        <AppBar
          title={`Order #${order?.orderNumber ?? id?.slice(0, 8) ?? ''}`}
          subtitle={subtitle}
          action={(
            <Pressable
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/orders' as never)}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close order details"
            >
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
          kind={errorKind === 'offline' ? 'offline' : 'error'}
          title={errorKind === 'notFound' ? 'Order unavailable' : errorKind === 'offline' ? t('states.offline') : t('states.error')}
          message={error || 'Order not found'}
          actionLabel={errorKind === 'notFound' ? 'Back to orders' : t('states.retry')}
          onAction={errorKind === 'notFound'
            ? () => router.replace('/(tabs)/orders' as never)
            : () => void loadOrder(true)}
        />
      ) : (
        <View style={styles.container}>
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <ThemedText style={styles.storeName}>{order.outlet.name}</ThemedText>
                {order.placedAt ? (
                  <ThemedText type="small" themeColor="textSecondary">Placed {new Date(order.placedAt).toLocaleString()}</ThemedText>
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
              <OrderFlowTracker
                status={order.status}
                fulfilmentMode={order.fulfilmentMode}
                deliveryStatus={tracking?.deliveryStatus}
                statusHistory={order.statusHistory}
              />
            </View>
            {activeOrderPollInterval(order.status) ? (
              <ThemedText type="small" themeColor="textSecondary">Refreshing automatically while this order is active.</ThemedText>
            ) : null}
          </View>

          {isDelivery ? (
            <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.row}>
                <ThemedText style={styles.sectionTitle}>Captain tracking</ThemedText>
                {tracking?.deliveryStatus ? (
                  <StatusBadge label={tracking.deliveryStatus.replaceAll('_', ' ')} tone="warning" />
                ) : null}
              </View>
              {trackingError ? (
                <ThemedText type="small" themeColor="textSecondary">{trackingError}</ThemedText>
              ) : tracking?.captain ? (
                <>
                  <DetailRow label="Captain" value="Assigned" />
                  {tracking.captain.assignedAt ? (
                    <DetailRow label="Assigned" value={new Date(tracking.captain.assignedAt).toLocaleTimeString()} />
                  ) : null}
                </>
              ) : order.status === 'READY_FOR_PICKUP' ? (
                <ThemedText type="small" themeColor="textSecondary">The order is ready, but no Captain assignment is currently available.</ThemedText>
              ) : order.status === 'PLACED' || order.status === 'ACCEPTED' || order.status === 'PREPARING' ? (
                <ThemedText type="small" themeColor="textSecondary">Captain tracking starts after the merchant marks the delivery ready.</ThemedText>
              ) : null}
              {tracking?.etaMinutes ? (
                <>
                  <DetailRow label="Checkout delivery estimate" value={`About ${tracking.etaMinutes} min`} />
                  <ThemedText type="small" themeColor="textSecondary">This is the server estimate captured for checkout, not a live arrival ETA.</ThemedText>
                </>
              ) : null}
              {tracking?.lastLocation ? (
                <View style={[styles.locationBox, { backgroundColor: theme.primarySoft }]} accessible accessibilityLabel={`Latest Captain location updated ${new Date(tracking.lastLocation.observedAt).toLocaleTimeString()}`}>
                  <ThemedText type="smallBold">Latest Captain location</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Updated {new Date(tracking.lastLocation.observedAt).toLocaleTimeString()} · {tracking.lastLocation.latitude.toFixed(4)}, {tracking.lastLocation.longitude.toFixed(4)}
                  </ThemedText>
                </View>
              ) : null}
              {order.status === 'DELIVERED' ? (
                <ThemedText type="small" themeColor="textSecondary">Captain location is no longer shared after delivery completion.</ThemedText>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.sectionTitle}>Order items</ThemedText>
            {order.items.map((item) => (
              <View key={item.listingId} style={styles.itemRow}>
                <View style={styles.flex}>
                  <ThemedText style={styles.itemName}>{item.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Qty {item.quantity} · {paise(item.unitPricePaise)} each</ThemedText>
                </View>
                <ThemedText type="smallBold">{paise(item.lineTotalPaise)}</ThemedText>
              </View>
            ))}
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <DetailRow label="Item subtotal" value={paise(order.pricing.itemSubtotalPaise)} />
            {order.pricing.itemDiscountPaise > 0 ? <DetailRow label="Item discount" value={negativePaise(order.pricing.itemDiscountPaise)} /> : null}
            {order.pricing.couponDiscountPaise > 0 ? <DetailRow label="Coupon discount" value={negativePaise(order.pricing.couponDiscountPaise)} /> : null}
            {order.pricing.loyaltyRewardPaise > 0 ? <DetailRow label="Loyalty reward" value={negativePaise(order.pricing.loyaltyRewardPaise)} /> : null}
            {order.pricing.taxPaise > 0 ? <DetailRow label="Tax" value={paise(order.pricing.taxPaise)} /> : null}
            <DetailRow label="Platform fee" value={paise(order.pricing.platformFeePaise)} />
            {order.pricing.deliveryFeePaise > 0 ? <DetailRow label="Delivery fee" value={paise(order.pricing.deliveryFeePaise)} /> : null}
            <View style={styles.row}>
              <ThemedText style={styles.totalLabel}>Server order total</ThemedText>
              <ThemedText style={[styles.totalValue, { color: theme.primary }]}>{paise(order.pricing.grandTotalPaise)}</ThemedText>
            </View>
          </View>

          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.sectionTitle}>Fulfilment & payment</ThemedText>
            <DetailRow label="Fulfilment" value={isDelivery ? 'MyPet Captain delivery' : 'Store pickup'} />
            <DetailRow label="Payment" value={paymentMethodLabel(order.paymentMethod)} />
            <DetailRow label="Payment status" value={order.paymentStatus.replaceAll('_', ' ')} />
          </View>

          {isDelivery && order.deliveryAddress ? (
            <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={styles.sectionTitle}>Delivery address</ThemedText>
              <ThemedText style={styles.itemName}>{order.deliveryAddress.recipientName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {order.deliveryAddress.line1}{order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ''}{'\n'}
                {order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.pincode}
              </ThemedText>
              <DetailRow label="Contact" value={order.deliveryAddress.phoneNumber} />
            </View>
          ) : null}

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

          {order.cancellation.cancelled ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.danger }]}>
              <ThemedText style={[styles.sectionTitle, { color: theme.danger }]}>Cancellation</ThemedText>
              {order.cancellation.cancelledAt ? <DetailRow label="Cancelled" value={new Date(order.cancellation.cancelledAt).toLocaleString()} /> : null}
              {order.cancellation.reason ? <ThemedText type="small" themeColor="textSecondary">{order.cancellation.reason}</ThemedText> : null}
            </View>
          ) : null}

          {order.canCancel ? (
            <Pressable
              style={({ pressed }) => [styles.cancelButton, { borderColor: theme.danger }, actionLoading && styles.disabled, pressed && styles.pressed]}
              onPress={() => void handleCancel()}
              disabled={actionLoading}
              accessibilityRole="button"
              accessibilityLabel="Cancel order"
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
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>{label}</ThemedText>
      <ThemedText type="smallBold" style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  backButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.x4, gap: spacing.x4, paddingBottom: spacing.x8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2 },
  detailLabel: { flexShrink: 0 },
  detailValue: { flexShrink: 1, minWidth: 0, textAlign: 'right' },
  storeName: { ...typography.title, flexShrink: 1 },
  sectionTitle: { ...typography.label, fontWeight: '700' },
  trackerBox: { padding: spacing.x3, borderRadius: radii.compact },
  locationBox: { padding: spacing.x3, borderRadius: radii.compact, gap: spacing.x1 },
  itemRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x1 },
  itemName: { ...typography.body, fontWeight: '700', flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.x1 },
  totalLabel: { ...typography.label },
  totalValue: { ...typography.title, fontWeight: '800', flexShrink: 1 },
  historyRow: { gap: spacing.x1, paddingVertical: spacing.x1 },
  cancelButton: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.82 },
});
