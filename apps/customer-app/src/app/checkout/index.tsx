import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useCart } from '@/context/CartContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { createPickupOrder } from '@/services/customer-checkout';
import { fetchCheckoutQuote, type CheckoutQuoteOutput } from '@/services/customer-orders';
import { appConfig } from '@/utils/app-config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function demoQuote(subtotal: number): CheckoutQuoteOutput {
  const quoteId = `DEMO-${Date.now()}`;
  return {
    quoteToken: quoteId,
    quoteId,
    cartSignature: 'demo-signature',
    fulfilmentMode: 'STORE_PICKUP',
    paymentMethod: 'PAY_ON_FULFILMENT',
    subtotal,
    itemDiscount: 0,
    couponDiscount: 0,
    loyaltyDiscount: 0,
    deliveryFee: 0,
    tax: 0,
    platformFee: 10,
    roundOff: 0,
    payableTotal: subtotal + 10,
    currency: 'INR',
    ruleVersion: 'demo-s1',
    couponCode: null,
    isCodAvailable: true,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

export default function CheckoutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { items, providerId, clearCart, loading: cartLoading } = useCart();

  const checkoutItems = useMemo(() => {
    const quantities = new Map<string, number>();
    items.forEach((item) => quantities.set(item.product.id, (quantities.get(item.product.id) ?? 0) + item.quantity));
    return Array.from(quantities, ([offeringId, quantity]) => ({ offeringId, quantity }));
  }, [items]);

  const itemSubtotal = useMemo(
    () => items.reduce((total, item) => total + item.unitPrice * item.quantity, 0),
    [items],
  );

  const hasPreviewItems = !providerId
    || !UUID_PATTERN.test(providerId)
    || checkoutItems.some((item) => !UUID_PATTERN.test(item.offeringId));
  const demoCheckout = appConfig.allowDemoMode && Boolean(providerId) && checkoutItems.length > 0 && hasPreviewItems;

  const [quote, setQuote] = useState<CheckoutQuoteOutput | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const loadQuote = useCallback(async () => {
    if (!user || !session || cartLoading) return;
    if (!providerId || checkoutItems.length === 0) {
      setQuote(null);
      setState('ready');
      return;
    }
    if (demoCheckout) {
      setQuote(demoQuote(itemSubtotal));
      setErrorMessage(null);
      setState('ready');
      return;
    }
    if (hasPreviewItems) {
      setQuote(null);
      setErrorMessage(null);
      setState('ready');
      return;
    }

    setState('loading');
    setErrorMessage(null);
    try {
      const nextQuote = await fetchCheckoutQuote({
        customerId: user.id,
        providerId,
        deliveryAddressId: '',
        items: checkoutItems,
        paymentMethod: 'PAY_ON_FULFILMENT',
      }, session.accessToken);
      if (!nextQuote.quoteId || !nextQuote.cartSignature) {
        throw new Error('Checkout quote is missing the canonical order credentials.');
      }
      setQuote(nextQuote);
      setState('ready');
    } catch (error) {
      setQuote(null);
      setErrorMessage(error instanceof Error ? error.message : 'Could not load checkout quote.');
      setState('error');
    }
  }, [cartLoading, checkoutItems, demoCheckout, hasPreviewItems, itemSubtotal, providerId, session, user]);

  useEffect(() => {
    if (user && session) void loadQuote();
  }, [loadQuote, session, user]);

  const handlePlaceOrder = async () => {
    if (!session || !quote || !providerId || checkoutItems.length === 0) return;
    if (demoCheckout) {
      Alert.alert('Demo pickup simulated', `₹${quote.payableTotal.toFixed(2)} was simulated. No backend order was created.`);
      return;
    }
    if (!quote.quoteId || !quote.cartSignature) {
      Alert.alert('Checkout expired', 'Request a fresh quote before placing the order.');
      return;
    }

    setPlacing(true);
    try {
      const order = await createPickupOrder(
        { quoteId: quote.quoteId, cartSignature: quote.cartSignature },
        session.accessToken,
      );
      await clearCart();
      router.replace(`/orders/${order.id}` as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not place the pickup order.';
      Alert.alert('Checkout failed', message);
      void loadQuote();
    } finally {
      setPlacing(false);
    }
  };

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="unauthenticated"
          title={t('states.unauthenticated')}
          message={t('routes.checkoutSignIn')}
          actionLabel={t('common.signIn')}
          onAction={() => void requireAuth({ action: 'CHECKOUT', returnTo: '/checkout' })}
        />
      </ScreenShell>
    );
  }

  if (state === 'loading' || cartLoading) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView kind="loading" title={t('states.loading')} message="Fetching the server-authoritative pickup total…" />
      </ScreenShell>
    );
  }

  if (state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="error"
          title="Checkout unavailable"
          message={errorMessage ?? 'Could not load checkout.'}
          actionLabel="Request fresh quote"
          onAction={() => void loadQuote()}
        />
      </ScreenShell>
    );
  }

  if (!providerId || checkoutItems.length === 0) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView kind="empty" title="Your cart is empty" message="Add an in-stock product before checkout." />
      </ScreenShell>
    );
  }

  if (hasPreviewItems && !demoCheckout) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="error"
          title="Preview products cannot be ordered"
          message="Clear sample catalog data and add products from a live provider."
          actionLabel="Clear preview cart"
          onAction={() => void clearCart()}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell header={<AppBar title={t('routes.checkout')} subtitle="Store pickup · Pay on fulfilment" />}>
      <View style={styles.container}>
        {demoCheckout ? (
          <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
            <StatusBadge label="DEMO CHECKOUT" tone="warning" />
            <ThemedText type="small" themeColor="textSecondary">Simulation only. No order or payment is created.</ThemedText>
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Fulfilment</ThemedText>
          <View style={styles.row}>
            <ThemedText>Store pickup</ThemedText>
            <StatusBadge label="SPRINT 1" tone="success" />
          </View>
          <ThemedText type="small" themeColor="textSecondary">The merchant prepares the order for pickup. Delivery is not enabled in Sprint 1.</ThemedText>
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Payment</ThemedText>
          <ThemedText>Pay on fulfilment</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">No online payment is collected in Sprint 1.</ThemedText>
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.row}>
            <ThemedText style={styles.cardTitle}>Order items</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{items.reduce((sum, item) => sum + item.quantity, 0)} items</ThemedText>
          </View>
          {items.map((item) => (
            <View key={`${item.product.id}-${item.selectedVariant?.id ?? 'default'}`} style={styles.row}>
              <View style={styles.itemCopy}>
                <ThemedText style={styles.itemName}>{item.product.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Qty {item.quantity}</ThemedText>
              </View>
              <ThemedText style={styles.price}>₹{(item.unitPrice * item.quantity).toFixed(2)}</ThemedText>
            </View>
          ))}
        </View>

        {quote ? (
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.cardTitle}>Server-authoritative total</ThemedText>
            <PriceRow label="Products" value={quote.subtotal} />
            {quote.itemDiscount > 0 ? <PriceRow label="Item discount" value={-quote.itemDiscount} /> : null}
            {quote.couponDiscount > 0 ? <PriceRow label="Coupon discount" value={-quote.couponDiscount} /> : null}
            {quote.loyaltyDiscount > 0 ? <PriceRow label="Loyalty reward" value={-quote.loyaltyDiscount} /> : null}
            {quote.platformFee ? <PriceRow label="Platform fee" value={quote.platformFee} /> : null}
            <PriceRow label="Delivery fee" value={quote.deliveryFee} />
            <PriceRow label="Tax" value={quote.tax} />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.row}>
              <ThemedText style={styles.totalLabel}>Pay on fulfilment</ThemedText>
              <ThemedText style={[styles.totalValue, { color: theme.primary }]}>₹{quote.payableTotal.toFixed(2)}</ThemedText>
            </View>
          </View>
        ) : null}

        <PrimaryAction
          label={demoCheckout ? `Simulate pickup · ₹${quote?.payableTotal.toFixed(2) ?? '0.00'}` : 'Place pickup order'}
          onPress={() => void handlePlaceOrder()}
          loading={placing}
        />
      </View>
    </ScreenShell>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText style={styles.price}>{value < 0 ? '-' : ''}₹{Math.abs(value).toFixed(2)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  cardTitle: { ...typography.label, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: '700', fontSize: 13, lineHeight: 18 },
  price: { fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  totalLabel: { ...typography.label, fontWeight: '800' },
  totalValue: { ...typography.title, fontWeight: '800' },
  notice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1 },
});
