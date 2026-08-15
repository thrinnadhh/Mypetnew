import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useCart } from '@/context/CartContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { createProductOrder, type ProductFulfilmentMode } from '@/services/customer-checkout';
import {
  clearPendingPayment,
  fetchPaymentStatus,
  initiateOrderPayment,
  loadPendingPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
  type CustomerPaymentView,
  type PendingPaymentRecovery,
} from '@/services/customer-payments';
import {
  fetchCaptainDeliveryQuote,
  fetchPickupQuote,
  type CanonicalProductQuote,
} from '@/services/customer-quotes';
import { fetchCustomerAddresses, type CustomerAddress } from '@/services/customer-profile';
import { appConfig } from '@/utils/app-config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutViewQuote = {
  quoteId: string;
  cartSignature: string;
  fulfilmentMode: ProductFulfilmentMode;
  paymentMethod: CustomerPaymentMethod;
  subtotal: number;
  itemDiscount: number;
  couponDiscount: number;
  loyaltyDiscount: number;
  deliveryFee: number;
  tax: number;
  platformFee: number;
  payableTotal: number;
  currency: 'INR';
  ruleVersion: string;
  expiresAt: string;
};

function quoteToView(quote: CanonicalProductQuote): CheckoutViewQuote {
  const rupees = (paise: number) => paise / 100;
  return {
    quoteId: quote.id,
    cartSignature: quote.cartSignature,
    fulfilmentMode: quote.fulfilmentMode,
    paymentMethod: quote.paymentMethod,
    subtotal: rupees(quote.pricing.itemSubtotalPaise),
    itemDiscount: rupees(quote.pricing.itemDiscountPaise),
    couponDiscount: rupees(quote.pricing.couponDiscountPaise),
    loyaltyDiscount: rupees(quote.pricing.loyaltyRewardPaise),
    deliveryFee: rupees(quote.pricing.deliveryFeePaise),
    tax: rupees(quote.pricing.taxPaise),
    platformFee: rupees(quote.pricing.platformFeePaise),
    payableTotal: rupees(quote.pricing.grandTotalPaise),
    currency: quote.pricing.currency,
    ruleVersion: quote.pricing.ruleVersion,
    expiresAt: quote.expiresAt,
  };
}

function demoQuote(subtotal: number): CheckoutViewQuote {
  return {
    quoteId: `DEMO-${Date.now()}`,
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
    payableTotal: subtotal + 10,
    currency: 'INR',
    ruleVersion: 'demo-s1',
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

  const [fulfilmentMode, setFulfilmentMode] = useState<ProductFulfilmentMode>('STORE_PICKUP');
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>('PAY_ON_FULFILMENT');
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [quote, setQuote] = useState<CheckoutViewQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<PendingPaymentRecovery | null>(null);

  useEffect(() => {
    if (!session) {
      setAddresses([]);
      setSelectedAddressId(null);
      setPendingRecovery(null);
      return;
    }
    let active = true;
    void fetchCustomerAddresses(session.accessToken)
      .then((nextAddresses) => {
        if (!active) return;
        setAddresses(nextAddresses);
        const preferred = nextAddresses.find((address) => address.isDefault) ?? nextAddresses[0] ?? null;
        setSelectedAddressId((current) => current && nextAddresses.some((address) => address.addressId === current)
          ? current
          : preferred?.addressId ?? null);
      })
      .catch(() => {
        if (!active) return;
        setAddresses([]);
        setSelectedAddressId(null);
      });
    void loadPendingPayment().then((recovery) => {
      if (active) setPendingRecovery(recovery);
    });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (demoCheckout && paymentMethod !== 'PAY_ON_FULFILMENT') {
      setPaymentMethod('PAY_ON_FULFILMENT');
    }
  }, [demoCheckout, paymentMethod]);

  const loadQuote = useCallback(async () => {
    if (!user || !session || cartLoading) return;
    if (!providerId || checkoutItems.length === 0) {
      setQuote(null);
      setState('ready');
      return;
    }
    if (demoCheckout) {
      setFulfilmentMode('STORE_PICKUP');
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
    if (fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' && !selectedAddressId) {
      setQuote(null);
      setErrorMessage(null);
      setState('ready');
      return;
    }

    setState('loading');
    setErrorMessage(null);
    try {
      const lines = checkoutItems.map((item) => ({ listingId: item.offeringId, quantity: item.quantity }));
      const canonical = fulfilmentMode === 'STORE_PICKUP'
        ? await fetchPickupQuote(providerId, lines, paymentMethod)
        : await fetchCaptainDeliveryQuote(providerId, selectedAddressId as string, lines, paymentMethod);
      setQuote(quoteToView(canonical));
      setState('ready');
    } catch (error) {
      setQuote(null);
      setErrorMessage(error instanceof Error ? error.message : 'Could not load checkout quote.');
      setState('error');
    }
  }, [cartLoading, checkoutItems, demoCheckout, fulfilmentMode, hasPreviewItems, itemSubtotal, paymentMethod, providerId, selectedAddressId, session, user]);

  useEffect(() => {
    if (user && session) void loadQuote();
  }, [loadQuote, session, user]);

  const finishVerifiedPayment = useCallback(async (payment: CustomerPaymentView, orderId: string) => {
    if (payment.status === 'CAPTURED') {
      await clearPendingPayment(payment.paymentId);
      await clearCart();
      setPendingRecovery(null);
      router.replace(`/orders/${orderId}` as never);
      return;
    }
    if (payment.status === 'FAILED' || payment.status === 'EXPIRED') {
      await clearPendingPayment(payment.paymentId);
      setPendingRecovery(null);
      Alert.alert(
        payment.status === 'EXPIRED' ? 'Payment window expired' : 'Payment could not be completed',
        'MyPet did not mark this order paid. Open the order to see its current server status.',
      );
      router.replace(`/orders/${orderId}` as never);
      return;
    }
    setPendingRecovery({ paymentId: payment.paymentId, orderId });
    Alert.alert(
      'Payment still verifying',
      'MyPet has not received final provider confirmation yet. You can safely resume verification from this checkout screen.',
    );
  }, [clearCart, router]);

  const verifyCanonicalPayment = useCallback(async (
    initial: CustomerPaymentView,
    orderId: string,
    launchProvider: boolean,
  ) => {
    setVerifying(true);
    try {
      if (launchProvider && initial.status !== 'CAPTURED' && initial.paymentSessionId) {
        // The callback result is deliberately ignored as payment truth. Both
        // success and error callbacks flow into the same backend verification.
        await openCashfreeOrder(initial).catch(() => 'ERROR' as const);
      }
      const finalPayment = initial.status === 'CAPTURED'
        ? initial
        : await waitForPaymentOutcome(initial.paymentId);
      await finishVerifiedPayment(finalPayment, orderId);
    } finally {
      setVerifying(false);
    }
  }, [finishVerifiedPayment]);

  const handleResumePayment = async () => {
    if (!pendingRecovery) return;
    setPlacing(true);
    try {
      const payment = await fetchPaymentStatus(pendingRecovery.paymentId);
      await verifyCanonicalPayment(payment, pendingRecovery.orderId, true);
    } catch (error) {
      Alert.alert('Could not resume payment', error instanceof Error ? error.message : 'Try again shortly.');
    } finally {
      setPlacing(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!session || !quote || !providerId || checkoutItems.length === 0) return;
    if (demoCheckout) {
      Alert.alert('Demo pickup simulated', `₹${quote.payableTotal.toFixed(2)} was simulated. No backend order was created.`);
      return;
    }

    setPlacing(true);
    try {
      const order = await createProductOrder(
        { quoteId: quote.quoteId, cartSignature: quote.cartSignature },
        fulfilmentMode,
        paymentMethod,
      );
      if (paymentMethod === 'PAY_ON_FULFILMENT') {
        await clearCart();
        router.replace(`/orders/${order.id}` as never);
        return;
      }

      const payment = await initiateOrderPayment(order.id);
      setPendingRecovery({ paymentId: payment.paymentId, orderId: order.id });
      await verifyCanonicalPayment(payment, order.id, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not place the order.';
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

  if (verifying) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="loading"
          title="Verifying payment…"
          message="Do not retry based on the Cashfree screen. MyPet is checking the canonical server payment state."
        />
      </ScreenShell>
    );
  }

  if (state === 'loading' || cartLoading) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView kind="loading" title={t('states.loading')} message="Fetching the server-authoritative checkout total…" />
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

  const selectedAddress = addresses.find((address) => address.addressId === selectedAddressId) ?? null;
  const isDelivery = fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY';
  const isOnline = paymentMethod === 'ONLINE_PAYMENT';

  return (
    <ScreenShell
      header={(
        <AppBar
          title={t('routes.checkout')}
          subtitle={`${isDelivery ? 'MyPet Captain delivery' : 'Store pickup'} · ${isOnline ? 'Online payment' : 'Pay on fulfilment'}`}
        />
      )}
    >
      <View style={styles.container}>
        {pendingRecovery ? (
          <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
            <StatusBadge label="PAYMENT VERIFICATION PENDING" tone="warning" />
            <ThemedText type="small" themeColor="textSecondary">
              A previous online order still has a server-side payment record. Resume it instead of creating a duplicate order.
            </ThemedText>
            <PrimaryAction label="Resume payment verification" onPress={() => void handleResumePayment()} loading={placing} />
          </View>
        ) : null}

        {demoCheckout ? (
          <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
            <StatusBadge label="DEMO CHECKOUT" tone="warning" />
            <ThemedText type="small" themeColor="textSecondary">Simulation only. No order or payment is created.</ThemedText>
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Fulfilment</ThemedText>
          <View style={styles.modeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: !isDelivery }}
              onPress={() => setFulfilmentMode('STORE_PICKUP')}
              style={[
                styles.modeOption,
                { borderColor: !isDelivery ? theme.primary : theme.border, backgroundColor: !isDelivery ? theme.primarySoft : theme.backgroundElement },
              ]}
            >
              <ThemedText style={styles.modeTitle}>Store pickup</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Collect from the merchant.</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isDelivery, disabled: demoCheckout }}
              disabled={demoCheckout}
              onPress={() => setFulfilmentMode('MYPET_CAPTAIN_DELIVERY')}
              style={[
                styles.modeOption,
                { borderColor: isDelivery ? theme.primary : theme.border, backgroundColor: isDelivery ? theme.primarySoft : theme.backgroundElement },
                demoCheckout && styles.disabledOption,
              ]}
            >
              <ThemedText style={styles.modeTitle}>Captain delivery</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Server-checked PIN serviceability.</ThemedText>
            </Pressable>
          </View>
        </View>

        {isDelivery ? (
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.row}>
              <ThemedText style={styles.cardTitle}>Delivery address</ThemedText>
              <StatusBadge label="PIN CHECKED" tone="success" />
            </View>
            {addresses.length === 0 ? (
              <View style={styles.addressEmpty}>
                <ThemedText type="small" themeColor="textSecondary">
                  Save an address in Profile before choosing Captain delivery. Precise Customer location is not required.
                </ThemedText>
                <PrimaryAction label="Open profile" onPress={() => router.push('/profile' as never)} />
              </View>
            ) : (
              addresses.map((address) => {
                const selected = address.addressId === selectedAddressId;
                return (
                  <Pressable
                    key={address.addressId}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setSelectedAddressId(address.addressId)}
                    style={[
                      styles.addressOption,
                      { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primarySoft : theme.background },
                    ]}
                  >
                    <View style={styles.row}>
                      <ThemedText style={styles.modeTitle}>{address.label}</ThemedText>
                      {address.isDefault ? <StatusBadge label="DEFAULT" /> : null}
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state} {address.pincode}
                    </ThemedText>
                  </Pressable>
                );
              })
            )}
            {selectedAddress ? (
              <ThemedText type="small" themeColor="textSecondary">
                Deliver to {selectedAddress.recipientName} · {selectedAddress.phoneNumber}
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Payment</ThemedText>
          <View style={styles.modeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: !isOnline }}
              onPress={() => setPaymentMethod('PAY_ON_FULFILMENT')}
              style={[
                styles.modeOption,
                { borderColor: !isOnline ? theme.primary : theme.border, backgroundColor: !isOnline ? theme.primarySoft : theme.backgroundElement },
              ]}
            >
              <ThemedText style={styles.modeTitle}>Pay on fulfilment</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Pay at pickup or fulfilment.</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isOnline, disabled: demoCheckout }}
              disabled={demoCheckout}
              onPress={() => setPaymentMethod('ONLINE_PAYMENT')}
              style={[
                styles.modeOption,
                { borderColor: isOnline ? theme.primary : theme.border, backgroundColor: isOnline ? theme.primarySoft : theme.backgroundElement },
                demoCheckout && styles.disabledOption,
              ]}
            >
              <ThemedText style={styles.modeTitle}>Pay online</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Cashfree secure checkout. Server verifies success.</ThemedText>
            </Pressable>
          </View>
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
              <ThemedText style={styles.totalLabel}>{isOnline ? 'Pay online' : 'Pay on fulfilment'}</ThemedText>
              <ThemedText style={[styles.totalValue, { color: theme.primary }]}>₹{quote.payableTotal.toFixed(2)}</ThemedText>
            </View>
          </View>
        ) : null}

        <PrimaryAction
          label={demoCheckout
            ? `Simulate pickup · ₹${quote?.payableTotal.toFixed(2) ?? '0.00'}`
            : isOnline
              ? `Continue to secure payment · ₹${quote?.payableTotal.toFixed(2) ?? '0.00'}`
              : isDelivery
                ? `Place delivery order · ₹${quote?.payableTotal.toFixed(2) ?? '0.00'}`
                : 'Place pickup order'}
          onPress={() => void handlePlaceOrder()}
          loading={placing}
          disabled={!quote || Boolean(pendingRecovery) || (isDelivery && !selectedAddressId)}
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
  modeRow: { flexDirection: 'row', gap: spacing.x2 },
  modeOption: { flex: 1, minHeight: 88, borderWidth: 1, borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1, justifyContent: 'center' },
  modeTitle: { fontWeight: '700' },
  disabledOption: { opacity: 0.5 },
  addressEmpty: { gap: spacing.x3 },
  addressOption: { borderWidth: 1, borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1 },
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: '700', fontSize: 13, lineHeight: 18 },
  price: { fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  totalLabel: { ...typography.label, fontWeight: '800' },
  totalValue: { ...typography.title, fontWeight: '800' },
  notice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x2 },
});
