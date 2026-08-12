import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBar,
  FilterChip,
  PrimaryAction,
  SectionHeader,
  StateView,
  StatusBadge,
} from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { AppCard } from '@/components/ui/app-card';
import { RECURRING_CADENCES, type RecurringCadence, type RecurringOrderSubscription } from '@/contracts/recurring-orders';
import { apiErrorMessage } from '@/contracts/api-error';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useCart } from '@/context/CartContext';
import { spacing, typography } from '@/design/tokens';
import {
  confirmRecurringOrder,
  createRecurringOrder,
  fetchRecurringOrders,
  updateRecurringOrder,
} from '@/services/recurring-orders';
import { buildCartFromRevalidation } from '@/services/revalidated-cart';

function statusTone(status: RecurringOrderSubscription['status']): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'AWAITING_CONFIRMATION') return 'warning';
  if (status === 'CANCELLED') return 'error';
  return 'neutral';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function RecurringOrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sourceOrderId?: string }>();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { replaceCart } = useCart();
  const [subscriptions, setSubscriptions] = useState<RecurringOrderSubscription[]>([]);
  const [cadence, setCadence] = useState<RecurringCadence>(30);
  const [quantityMultiplier, setQuantityMultiplier] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setSubscriptions(await fetchRecurringOrders(session.access_token));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const create = useCallback(async () => {
    if (!session || !params.sourceOrderId) return;
    setBusyId('create');
    try {
      const created = await createRecurringOrder(
        params.sourceOrderId,
        cadence,
        quantityMultiplier,
        session.access_token,
      );
      setSubscriptions((current) => [created, ...current]);
      Alert.alert('Recurring order created', 'MyPet will remind you before the next order. Payment is never charged automatically.');
    } catch (nextError) {
      Alert.alert('Could not subscribe', apiErrorMessage(nextError));
    } finally {
      setBusyId(null);
    }
  }, [cadence, params.sourceOrderId, quantityMultiplier, session]);

  const action = useCallback(async (
    subscription: RecurringOrderSubscription,
    nextAction: 'PAUSE' | 'RESUME' | 'SKIP' | 'CANCEL',
  ) => {
    if (!session) return;
    setBusyId(subscription.subscriptionId);
    try {
      const updated = await updateRecurringOrder(subscription.subscriptionId, nextAction, session.access_token);
      setSubscriptions((current) => current.map((item) => item.subscriptionId === updated.subscriptionId ? updated : item));
    } catch (nextError) {
      Alert.alert('Subscription update failed', apiErrorMessage(nextError));
    } finally {
      setBusyId(null);
    }
  }, [session]);

  const confirm = useCallback(async (subscription: RecurringOrderSubscription) => {
    if (!session) return;
    setBusyId(subscription.subscriptionId);
    try {
      const result = await confirmRecurringOrder(subscription.subscriptionId, session.access_token);
      setSubscriptions((current) => current.map((item) => item.subscriptionId === result.subscription.subscriptionId ? result.subscription : item));
      if (result.reorder.canReorder) {
        const nextItems = await buildCartFromRevalidation(result.reorder);
        await replaceCart(nextItems);
        Alert.alert(
          'Order revalidated',
          'Current products and quantities are in your cart. Checkout will calculate a new server-authoritative quote.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open cart', onPress: () => router.push('/cart' as never) },
          ],
        );
      } else {
        const unavailable = result.reorder.items
          .filter((item) => !item.isAvailable)
          .map((item) => `${item.offeringName}: ${item.message ?? 'Unavailable'}`)
          .join('\n');
        Alert.alert('Confirmation needs changes', unavailable || 'The provider or one of the items is currently unavailable.');
      }
    } catch (nextError) {
      Alert.alert('Confirmation failed', apiErrorMessage(nextError));
    } finally {
      setBusyId(null);
    }
  }, [replaceCart, router, session]);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Recurring orders" subtitle="Scheduled reminders with confirmation" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in to manage subscriptions"
          message="MyPet revalidates stock and price before every recurring order."
          actionLabel="Sign in"
          onAction={() => void requireAuth({ action: 'ORDER_HISTORY', returnTo: '/subscriptions' })}
        />
      </ScreenShell>
    );
  }

  if (loading) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Recurring orders" />}>
        <StateView kind="loading" title="Loading subscriptions" />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      header={<AppBar title="Recurring orders" subtitle="No silent charging—every order requires confirmation" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      testID="recurring-orders-screen"
    >
      {params.sourceOrderId ? (
        <AppCard style={styles.card}>
          <SectionHeader title="Subscribe to this order" />
          <ThemedText type="small" themeColor="textSecondary">
            Source order #{params.sourceOrderId.slice(0, 8).toUpperCase()}. A reminder is created; checkout still generates a fresh quote.
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {RECURRING_CADENCES.map((days) => (
              <FilterChip key={days} label={`${days} days`} selected={cadence === days} onPress={() => setCadence(days)} />
            ))}
          </ScrollView>
          <View style={styles.row}>
            {[1, 2, 3, 4].map((quantity) => (
              <FilterChip key={quantity} label={`${quantity}× quantity`} selected={quantityMultiplier === quantity} onPress={() => setQuantityMultiplier(quantity)} />
            ))}
          </View>
          <PrimaryAction label="Create recurring reminder" loading={busyId === 'create'} onPress={() => void create()} />
        </AppCard>
      ) : null}

      {error ? (
        <StateView kind="error" title="Subscriptions unavailable" message={apiErrorMessage(error)} actionLabel="Retry" onAction={() => void load()} />
      ) : null}

      {!error && subscriptions.length === 0 ? (
        <StateView kind="empty" title="No recurring orders" message="Open a completed order and select Subscribe to create a 7, 15, 25, 30 or 35 day reminder." />
      ) : null}

      {!error && subscriptions.length > 0 ? (
        <View style={styles.list}>
          {subscriptions.map((subscription) => (
            <AppCard key={subscription.subscriptionId} style={styles.card}>
              <View style={styles.headerRow}>
                <View style={styles.flex}>
                  <ThemedText style={styles.title}>Every {subscription.cadenceDays} days</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Order #{subscription.sourceOrderId.slice(0, 8).toUpperCase()} · {subscription.quantityMultiplier}× quantity
                  </ThemedText>
                </View>
                <StatusBadge label={subscription.status.replaceAll('_', ' ')} tone={statusTone(subscription.status)} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">Next reminder {formatDate(subscription.nextOrderAt)}</ThemedText>

              {subscription.status === 'AWAITING_CONFIRMATION' ? (
                <PrimaryAction label="Revalidate and confirm" loading={busyId === subscription.subscriptionId} onPress={() => void confirm(subscription)} />
              ) : null}

              {subscription.status !== 'CANCELLED' ? (
                <View style={styles.actions}>
                  {subscription.status === 'PAUSED' ? (
                    <FilterChip label="Resume" selected={false} onPress={() => void action(subscription, 'RESUME')} />
                  ) : (
                    <FilterChip label="Pause" selected={false} onPress={() => void action(subscription, 'PAUSE')} />
                  )}
                  <FilterChip label="Skip next" selected={false} onPress={() => void action(subscription, 'SKIP')} />
                  <FilterChip label="Cancel" selected={false} onPress={() => void action(subscription, 'CANCEL')} />
                </View>
              ) : null}
            </AppCard>
          ))}
        </View>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.x4 },
  card: { gap: spacing.x3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  flex: { flex: 1 },
  title: { ...typography.title },
});
