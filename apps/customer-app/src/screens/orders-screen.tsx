import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, FilterChip, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useOrders } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import type { CustomerOrderRecord } from '@/services/customer-orders';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formattedOrderDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (['DELIVERED', 'COMPLETED'].includes(status)) return 'success';
  if (['CANCELLED', 'REJECTED'].includes(status)) return 'error';
  if (['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP'].includes(status)) {
    return 'warning';
  }
  return 'neutral';
}

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { requireAuth } = useAuthIntent();

  const {
    user,
    session,
    filteredOrders,
    state,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    actionLoading,
    reload,
    cancel,
    reorder,
  } = useOrders();

  const [selectedOrderForCancel, setSelectedOrderForCancel] = useState<CustomerOrderRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('ordersFoundation.title')} subtitle={t('ordersFoundation.subtitle')} />}>
        <StateView
          kind="unauthenticated"
          title={t('states.unauthenticated')}
          message={t('ordersFoundation.signInMessage')}
          actionLabel={t('common.signIn')}
          onAction={() => void requireAuth({ action: 'ORDER_HISTORY', returnTo: '/(tabs)/orders' })}
        />
      </ScreenShell>
    );
  }

  const handleCancelSubmit = async () => {
    if (!selectedOrderForCancel) return;
    try {
      await cancel(selectedOrderForCancel.id, cancelReason.trim() || 'Cancelled by customer');
      setSelectedOrderForCancel(null);
      setCancelReason('');
      Alert.alert(t('common.success'), 'Order cancelled successfully.');
    } catch (error: unknown) {
      Alert.alert(t('common.error'), errorMessage(error, 'Could not cancel order.'));
    }
  };

  const handleReorder = async (orderId: string) => {
    try {
      const result = await reorder(orderId);
      if (result?.canReorder) {
        Alert.alert('Reorder validated', 'All items are available at current prices. Continue to cart?', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Go to cart', onPress: () => router.push('/cart' as never) },
        ]);
        return;
      }

      if (result) {
        const unavailable = result.items
          .filter((item) => !item.isAvailable)
          .map((item) => `${item.offeringName}: ${item.message ?? 'Unavailable'}`)
          .join('\n');
        Alert.alert('Reorder unavailable', unavailable || 'One or more items are unavailable.');
      }
    } catch (error: unknown) {
      Alert.alert(t('common.error'), errorMessage(error, 'Could not revalidate reorder.'));
    }
  };

  return (
    <ScreenShell
      header={<AppBar title={t('ordersFoundation.title')} subtitle="Track deliveries, subscriptions, and past purchases" />}
      testID="orders-screen"
    >
      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          <FilterChip label="Active" selected={activeTab === 'active'} onPress={() => setActiveTab('active')} />
          <FilterChip label="Past orders" selected={activeTab === 'past'} onPress={() => setActiveTab('past')} />
          <FilterChip label="Subscriptions" selected={activeTab === 'subscription'} onPress={() => setActiveTab('subscription')} />
        </ScrollView>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <AppIcon name="search" size={18} color={theme.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search item or store…"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            accessibilityLabel="Search orders"
            returnKeyType="search"
            maxFontSizeMultiplier={1.6}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear order search"
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <AppIcon name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {state === 'loading' || state === 'idle' ? (
        <StateView kind="loading" title={t('states.loading')} message={t('states.loadingMessage')} />
      ) : null}
      {state === 'offline' ? (
        <StateView
          kind="offline"
          title={t('states.offline')}
          message={t('states.offlineMessage')}
          actionLabel={t('states.retry')}
          onAction={() => void reload()}
        />
      ) : null}
      {state === 'error' ? (
        <StateView
          kind="error"
          title={t('states.error')}
          message={t('ordersFoundation.loadError')}
          actionLabel={t('states.retry')}
          onAction={() => void reload()}
        />
      ) : null}
      {state === 'ready' && filteredOrders.length === 0 ? (
        <StateView
          kind="empty"
          title={searchQuery ? 'No matching orders' : t('ordersFoundation.emptyTitle')}
          message={searchQuery ? 'Try another item or store name.' : t('ordersFoundation.emptyMessage')}
          actionLabel={searchQuery ? 'Clear search' : undefined}
          onAction={searchQuery ? () => setSearchQuery('') : undefined}
        />
      ) : null}

      {state === 'ready' && filteredOrders.length > 0 ? (
        <View style={styles.list}>
          {filteredOrders.map((order) => {
            const isCancellable = order.status === 'PLACED';
            const isPast = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status);
            const tone = statusTone(order.status);
            const accentColor =
              tone === 'success'
                ? theme.success
                : tone === 'error'
                  ? theme.danger
                  : tone === 'warning'
                    ? theme.warning
                    : theme.textSecondary;

            return (
              <View
                key={order.id}
                style={[
                  styles.orderCard,
                  shadows.card,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    borderLeftColor: accentColor,
                  },
                ]}
                accessible
                accessibilityLabel={`Order ${order.id.slice(0, 8)} from ${order.providerName}. ${order.status}. Total ${order.total}.`}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.storeIcon, { backgroundColor: theme.primarySoft }]}>
                    <AppIcon name={order.isSubscription ? 'history' : 'store'} size={23} color={theme.primary} />
                  </View>
                  <View style={styles.flex}>
                    <ThemedText style={styles.storeName}>{order.providerName}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      #{order.id.slice(0, 8).toUpperCase()} · {formattedOrderDate(order.orderedAt)}
                    </ThemedText>
                  </View>
                  <StatusBadge label={order.status.replaceAll('_', ' ')} tone={tone} />
                </View>

                <View style={[styles.itemsPanel, { backgroundColor: theme.muted }]}>
                  <ThemedText type="smallBold">{order.items.length} item{order.items.length === 1 ? '' : 's'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                    {order.items.join(' · ')}
                  </ThemedText>
                </View>

                <View style={styles.amountRow}>
                  <View>
                    <ThemedText type="small" themeColor="textSecondary">Total paid</ThemedText>
                    <ThemedText style={[styles.amountText, { color: theme.primary }]}>{order.total}</ThemedText>
                  </View>
                  {order.isSubscription ? <StatusBadge label="SUBSCRIPTION" tone="success" /> : null}
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryCardAction,
                      { backgroundColor: theme.primarySoft },
                      pressed && styles.pressed,
                    ]}
                    onPress={() => router.push(`/orders/${order.id}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={isPast ? `View order ${order.id.slice(0, 8)}` : `Track order ${order.id.slice(0, 8)}`}
                  >
                    <AppIcon name={isPast ? 'chevron' : 'location'} size={18} color={theme.primary} />
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>
                      {isPast ? 'View details' : 'Track order'}
                    </ThemedText>
                  </Pressable>

                  {isCancellable ? (
                    <Pressable
                      style={({ pressed }) => [styles.iconAction, { borderColor: theme.border }, pressed && styles.pressed]}
                      onPress={() => setSelectedOrderForCancel(order)}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel order ${order.id.slice(0, 8)}`}
                    >
                      <AppIcon name="close" size={20} color={theme.danger} />
                    </Pressable>
                  ) : null}

                  {isPast ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.reorderAction,
                        { backgroundColor: theme.accentSoft },
                        pressed && styles.pressed,
                      ]}
                      onPress={() => void handleReorder(order.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Reorder from ${order.providerName}`}
                    >
                      <AppIcon name="cart" size={18} color={theme.accent} />
                      <ThemedText type="smallBold" style={{ color: theme.accent }}>Reorder</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <Modal
        visible={Boolean(selectedOrderForCancel)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedOrderForCancel(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityViewIsModal
          >
            <ThemedText type="title">Cancel order</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Cancel order #{selectedOrderForCancel?.id.slice(0, 8).toUpperCase()} from {selectedOrderForCancel?.providerName}?
            </ThemedText>

            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Reason for cancellation (optional)…"
              placeholderTextColor={theme.textSecondary}
              style={[styles.reasonInput, { color: theme.text, borderColor: theme.border }]}
              multiline
              accessibilityLabel="Order cancellation reason"
              maxFontSizeMultiplier={1.6}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalSecondary, pressed && styles.pressed]}
                onPress={() => setSelectedOrderForCancel(null)}
                accessibilityRole="button"
                accessibilityLabel="Keep order"
              >
                <ThemedText type="smallBold" themeColor="textSecondary">Keep order</ThemedText>
              </Pressable>
              <PrimaryAction label="Confirm cancellation" onPress={() => void handleCancelSubmit()} loading={actionLoading} />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { paddingHorizontal: spacing.x4, gap: spacing.x3, marginBottom: spacing.x3 },
  tabsScroll: { flexDirection: 'row', gap: spacing.x2, paddingRight: spacing.x4 },
  searchBox: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderRadius: radii.compact,
    paddingLeft: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  searchInput: { flex: 1, minHeight: touchTarget, ...typography.body, paddingVertical: 0 },
  clearButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x6 },
  orderCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 5,
    borderRadius: radii.card,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  storeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  storeName: { ...typography.title, fontSize: 18, lineHeight: 24 },
  itemsPanel: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  amountText: { ...typography.title, fontSize: 18, lineHeight: 24 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2, alignItems: 'center' },
  primaryCardAction: {
    minHeight: touchTarget,
    flexGrow: 1,
    minWidth: 150,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.x4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
  },
  iconAction: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.compact,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderAction: {
    minHeight: touchTarget,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11,28,48,0.52)', justifyContent: 'center', padding: spacing.x4 },
  modalBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x6, gap: spacing.x3 },
  reasonInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radii.compact,
    padding: spacing.x3,
    textAlignVertical: 'top',
    ...typography.body,
  },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.x2 },
  modalSecondary: { minHeight: touchTarget, paddingHorizontal: spacing.x3, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.82 },
});