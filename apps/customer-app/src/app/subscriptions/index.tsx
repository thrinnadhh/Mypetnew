import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  RECURRING_CADENCES,
  type RecurringCadence,
  type RecurringOrderConfirmation,
  type RecurringOrderSubscription,
  type RenewalProposal,
} from '@/contracts/recurring-orders';
import { apiErrorMessage } from '@/contracts/api-error';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useCart } from '@/context/CartContext';
import { spacing, typography } from '@/design/tokens';
import { apiClient } from '@/services/api-client';
import {
  completeRecurringHandoff,
  loadRecurringCheckoutHandoff,
  saveRecurringCheckoutHandoff,
} from '@/services/recurring-handoff';
import {
  confirmRecurringProposal,
  createRecurringOrder,
  fetchRecurringOrders,
  fetchRenewalProposals,
  recurringCommandKey,
  updateRecurringOrder,
} from '@/services/recurring-orders';
import { buildCartFromRevalidation } from '@/services/revalidated-cart';

function subscriptionTone(status: RecurringOrderSubscription['status']): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'CANCELLED') return 'error';
  if (status === 'AWAITING_CONFIRMATION') return 'warning';
  return 'neutral';
}

function proposalTone(status: RenewalProposal['status']): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'ORDER_CREATED') return 'success';
  if (status === 'AWAITING_CONFIRMATION' || status === 'CONFIRMED' || status === 'DUE') return 'warning';
  if (status === 'REVALIDATION_FAILED' || status === 'EXPIRED') return 'error';
  return 'neutral';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

type AccountContext = { userId: string; accessToken: string; authEpoch: number };

export default function RecurringOrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sourceOrderId?: string }>();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { replaceCart, providerId: cartProviderId } = useCart();
  const [subscriptions, setSubscriptions] = useState<RecurringOrderSubscription[]>([]);
  const [proposals, setProposals] = useState<RenewalProposal[]>([]);
  const [cadence, setCadence] = useState<RecurringCadence>(30);
  const [quantityMultiplier, setQuantityMultiplier] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const accountRef = useRef<{ userId?: string; accessToken?: string; authEpoch: number }>({ authEpoch: apiClient.getAuthEpoch() });
  const cartProviderRef = useRef<string | null>(cartProviderId);
  const busyTokenRef = useRef<string | null>(null);
  const commandKeysRef = useRef(new Map<string, string>());

  accountRef.current = {
    userId: user?.id,
    accessToken: session?.accessToken,
    authEpoch: apiClient.getAuthEpoch(),
  };
  cartProviderRef.current = cartProviderId;

  const captureAccount = useCallback((): AccountContext | null => {
    const current = accountRef.current;
    if (!current.userId || !current.accessToken) return null;
    return { userId: current.userId, accessToken: current.accessToken, authEpoch: current.authEpoch };
  }, []);

  const accountStillCurrent = useCallback((captured: AccountContext): boolean => {
    const current = accountRef.current;
    return current.userId === captured.userId
      && current.accessToken === captured.accessToken
      && current.authEpoch === captured.authEpoch
      && apiClient.getAuthEpoch() === captured.authEpoch;
  }, []);

  const commandKey = useCallback((identity: string, account: AccountContext): string => {
    const existing = commandKeysRef.current.get(identity);
    if (existing) return existing;
    const next = recurringCommandKey(account.userId, identity.split(':')[0], identity, Date.now());
    commandKeysRef.current.set(identity, next);
    return next;
  }, []);

  const load = useCallback(async () => {
    const captured = captureAccount();
    if (!captured) {
      setSubscriptions([]);
      setProposals([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const handoff = await loadRecurringCheckoutHandoff(captured.userId);
      if (handoff?.orderId && handoff.checkoutIdempotencyKey && accountStillCurrent(captured)) {
        await completeRecurringHandoff(handoff).catch(() => false);
      }
      const [nextSubscriptions, nextProposals] = await Promise.all([
        fetchRecurringOrders(captured.accessToken),
        fetchRenewalProposals(captured.accessToken),
      ]);
      if (!accountStillCurrent(captured)) return;
      setSubscriptions(nextSubscriptions);
      setProposals(nextProposals);
    } catch (nextError) {
      if (accountStillCurrent(captured)) setError(nextError);
    } finally {
      if (accountStillCurrent(captured)) setLoading(false);
    }
  }, [accountStillCurrent, captureAccount]);

  useEffect(() => {
    setLoading(true);
    setSubscriptions([]);
    setProposals([]);
    setError(null);
    void load();
  }, [load, session?.accessToken, user?.id]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const create = useCallback(async () => {
    const captured = captureAccount();
    if (!captured || !params.sourceOrderId || busyTokenRef.current) return;
    const identity = `create:${params.sourceOrderId}:${cadence}:${quantityMultiplier}`;
    const token = `${identity}:${Date.now()}`;
    busyTokenRef.current = token;
    setBusyId('create');
    try {
      const created = await createRecurringOrder(
        params.sourceOrderId,
        cadence,
        quantityMultiplier,
        captured.accessToken,
        commandKey(identity, captured),
      );
      if (!accountStillCurrent(captured)) return;
      commandKeysRef.current.delete(identity);
      setSubscriptions((current) => [created, ...current.filter((item) => item.subscriptionId !== created.subscriptionId)]);
      Alert.alert('Recurring reminder created', 'MyPet will create a renewal proposal when due. No order or payment is created automatically.');
    } catch (nextError) {
      if (accountStillCurrent(captured)) Alert.alert('Could not subscribe', apiErrorMessage(nextError));
    } finally {
      if (busyTokenRef.current === token) {
        busyTokenRef.current = null;
        if (accountStillCurrent(captured)) setBusyId(null);
      }
    }
  }, [accountStillCurrent, cadence, captureAccount, commandKey, params.sourceOrderId, quantityMultiplier]);

  const action = useCallback(async (
    subscription: RecurringOrderSubscription,
    nextAction: 'PAUSE' | 'RESUME' | 'SKIP' | 'CANCEL',
  ) => {
    const captured = captureAccount();
    if (!captured || busyTokenRef.current) return;
    const identity = `${nextAction}:${subscription.subscriptionId}:${subscription.version}`;
    const token = `${identity}:${Date.now()}`;
    busyTokenRef.current = token;
    setBusyId(subscription.subscriptionId);
    try {
      const updated = await updateRecurringOrder(
        subscription.subscriptionId,
        nextAction,
        captured.accessToken,
        commandKey(identity, captured),
      );
      if (!accountStillCurrent(captured)) return;
      commandKeysRef.current.delete(identity);
      setSubscriptions((current) => current.map((item) => item.subscriptionId === updated.subscriptionId ? updated : item));
      await load();
    } catch (nextError) {
      if (accountStillCurrent(captured)) Alert.alert('Subscription update failed', apiErrorMessage(nextError));
    } finally {
      if (busyTokenRef.current === token) {
        busyTokenRef.current = null;
        if (accountStillCurrent(captured)) setBusyId(null);
      }
    }
  }, [accountStillCurrent, captureAccount, commandKey, load]);

  const installConfirmedCart = useCallback(async (
    result: RecurringOrderConfirmation,
    captured: AccountContext,
  ) => {
    const nextItems = await buildCartFromRevalidation(result.reorder);
    if (!accountStillCurrent(captured)) return;

    const apply = async () => {
      if (!accountStillCurrent(captured)) return;
      await saveRecurringCheckoutHandoff({
        customerId: captured.userId,
        subscriptionId: result.subscription.subscriptionId,
        proposalId: result.proposal.proposalId,
        providerId: result.proposal.providerId,
        fulfilmentMode: result.proposal.fulfilmentMode,
        createdAt: new Date().toISOString(),
      });
      if (!accountStillCurrent(captured)) return;
      await replaceCart(nextItems);
      if (!accountStillCurrent(captured)) return;
      Alert.alert(
        'Renewal ready for checkout',
        'Current items are in your cart. Checkout still requires a fresh server quote and normal payment choice.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open cart', onPress: () => { if (accountStillCurrent(captured)) router.push('/cart' as never); } },
        ],
      );
    };

    const existingProvider = cartProviderRef.current;
    if (existingProvider && existingProvider !== result.proposal.providerId) {
      Alert.alert(
        'Replace cart items?',
        'Your current cart belongs to another store. MyPet never merges merchants for a renewal.',
        [
          { text: 'Keep current cart', style: 'cancel' },
          { text: 'Replace & continue', style: 'destructive', onPress: () => { void apply(); } },
        ],
      );
      return;
    }
    await apply();
  }, [accountStillCurrent, replaceCart, router]);

  const confirm = useCallback(async (proposal: RenewalProposal) => {
    const captured = captureAccount();
    if (!captured || busyTokenRef.current) return;
    const identity = `confirm:${proposal.proposalId}:${proposal.version}`;
    const token = `${identity}:${Date.now()}`;
    busyTokenRef.current = token;
    setBusyId(proposal.proposalId);
    try {
      const result = await confirmRecurringProposal(
        proposal.subscriptionId,
        proposal.proposalId,
        captured.accessToken,
        commandKey(identity, captured),
      );
      if (!accountStillCurrent(captured)) return;
      if (result.reorder.canReorder) {
        await installConfirmedCart(result, captured);
      } else {
        const unavailable = result.reorder.items
          .filter((item) => !item.isAvailable)
          .map((item) => `${item.offeringName}: ${item.message ?? 'Unavailable'}`)
          .join('\n');
        Alert.alert('Renewal needs changes', unavailable || 'The provider or one of the items is currently unavailable.');
      }
      if (accountStillCurrent(captured)) await load();
    } catch (nextError) {
      if (accountStillCurrent(captured)) Alert.alert('Confirmation failed', apiErrorMessage(nextError));
    } finally {
      if (busyTokenRef.current === token) {
        busyTokenRef.current = null;
        if (accountStillCurrent(captured)) setBusyId(null);
      }
    }
  }, [accountStillCurrent, captureAccount, commandKey, installConfirmedCart, load]);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Recurring orders" subtitle="Scheduled proposals with confirmation" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in to manage subscriptions"
          message="MyPet revalidates stock, price and serviceability before every renewal."
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
      header={<AppBar title="Recurring orders" subtitle="No silent order or charge—every renewal requires you" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      testID="recurring-orders-screen"
    >
      {params.sourceOrderId ? (
        <AppCard style={styles.card}>
          <SectionHeader title="Subscribe to this order" />
          <ThemedText type="small" themeColor="textSecondary">
            Source order #{params.sourceOrderId.slice(0, 8).toUpperCase()}. Due cycles create proposals only; checkout remains authoritative.
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

      {!error && proposals.some((proposal) => proposal.status !== 'ORDER_CREATED' && proposal.status !== 'SKIPPED' && proposal.status !== 'EXPIRED') ? (
        <View style={styles.list}>
          <SectionHeader title="Renewal proposals" />
          {proposals
            .filter((proposal) => proposal.status !== 'ORDER_CREATED' && proposal.status !== 'SKIPPED' && proposal.status !== 'EXPIRED')
            .map((proposal) => (
              <AppCard key={proposal.proposalId} style={styles.card}>
                <View style={styles.headerRow}>
                  <View style={styles.flex}>
                    <ThemedText style={styles.title}>Renewal due {formatDate(proposal.dueCycleAt)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Expires {formatDate(proposal.expiresAt)}</ThemedText>
                  </View>
                  <StatusBadge label={proposal.status.replaceAll('_', ' ')} tone={proposalTone(proposal.status)} />
                </View>
                {(proposal.status === 'AWAITING_CONFIRMATION' || proposal.status === 'REVALIDATION_FAILED') ? (
                  <PrimaryAction
                    label="Revalidate and continue"
                    loading={busyId === proposal.proposalId}
                    onPress={() => void confirm(proposal)}
                  />
                ) : proposal.status === 'CONFIRMED' ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Confirmed intent is waiting for normal cart → quote → checkout. No order has been created yet.
                  </ThemedText>
                ) : null}
              </AppCard>
            ))}
        </View>
      ) : null}

      {!error && subscriptions.length === 0 ? (
        <StateView kind="empty" title="No recurring orders" message="Open a completed order and select Subscribe to create a 7, 15, 25, 30 or 35 day reminder." />
      ) : null}

      {!error && subscriptions.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader title="Schedules" />
          {subscriptions.map((subscription) => (
            <AppCard key={subscription.subscriptionId} style={styles.card}>
              <View style={styles.headerRow}>
                <View style={styles.flex}>
                  <ThemedText style={styles.title}>Every {subscription.cadenceDays} days</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Order #{subscription.sourceOrderId.slice(0, 8).toUpperCase()} · {subscription.quantityMultiplier}× quantity
                  </ThemedText>
                </View>
                <StatusBadge label={subscription.status.replaceAll('_', ' ')} tone={subscriptionTone(subscription.status)} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">Next cycle {formatDate(subscription.nextOrderAt)}</ThemedText>
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
