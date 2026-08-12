import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppIcon } from '@/components/app-icon';
import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import {
  CHECKOUT_TAX_RATE,
  DELIVERY_BASE_FEE,
  DELIVERY_INCLUDED_DISTANCE_KM,
  DELIVERY_MAX_SERVICE_DISTANCE_KM,
  DELIVERY_PER_KM_FEE,
  DELIVERY_ROUTE_DISTANCE_FACTOR,
} from '@/contracts/checkout-pricing.generated';
import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useCart } from '@/context/CartContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  createCustomerOrder,
  fetchCheckoutQuote,
  type CheckoutQuoteOutput,
  type CustomerOrderRecord,
} from '@/services/customer-orders';
import {
  initiateOrderPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
} from '@/services/customer-payments';
import { DEMO_MEDIA } from '@/services/demo-customer-data';
import { fetchDefaultAddress, isOfflineError, type CustomerAddress } from '@/services/customer-profile';
import { appConfig } from '@/utils/app-config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_METHODS: Array<{ id: CustomerPaymentMethod; label: string }> = [
  { id: 'COD', label: 'Cash on delivery' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Card' },
];

const DEMO_ADDRESS: CustomerAddress = {
  addressId: 'demo-address',
  label: 'Demo',
  line1: 'MyPet demo delivery address',
  line2: null,
  city: 'Tirupati',
  state: 'Andhra Pradesh',
  pincode: '517501',
  geoLat: 13.6288,
  geoLng: 79.4192,
  isDefault: true,
};

// Demo mode changes data source/external effects only. Pricing uses the same
// merchant-origin and promotion algorithms as production.
const DEMO_MERCHANT_LOCATION = { latitude: 13.6355, longitude: 79.4199 };
const DEMO_PROMOTIONS = {
  DEMO10: { discountType: 'PERCENTAGE', discountValue: 10, maxDiscountAmount: 100 },
  DEMO50: { discountType: 'FLAT', discountValue: 50, maxDiscountAmount: null },
} as const;

type DemoPromotionCode = keyof typeof DEMO_PROMOTIONS;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371.0088;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

function demoDeliveryFee(address: CustomerAddress): number {
  const straightLineKm = haversineKm(
    DEMO_MERCHANT_LOCATION.latitude,
    DEMO_MERCHANT_LOCATION.longitude,
    address.geoLat ?? DEMO_ADDRESS.geoLat!,
    address.geoLng ?? DEMO_ADDRESS.geoLng!,
  );
  const routeKm = roundMoney(straightLineKm * DELIVERY_ROUTE_DISTANCE_FACTOR);
  if (routeKm > DELIVERY_MAX_SERVICE_DISTANCE_KM) {
    throw new Error('Demo address is outside the canonical merchant delivery radius.');
  }
  const billableKm = Math.max(0, routeKm - DELIVERY_INCLUDED_DISTANCE_KM);
  return roundMoney(DELIVERY_BASE_FEE + billableKm * DELIVERY_PER_KM_FEE);
}

function demoCouponDiscount(couponCode: string | null, sellingSubtotal: number): number {
  if (!couponCode) return 0;
  const promotion = DEMO_PROMOTIONS[couponCode as DemoPromotionCode];
  if (!promotion) throw new Error('Invalid demo coupon. Use DEMO10 or DEMO50.');

  if (promotion.discountType === 'PERCENTAGE') {
    const raw = roundMoney(sellingSubtotal * promotion.discountValue / 100);
    return roundMoney(Math.min(raw, promotion.maxDiscountAmount ?? raw));
  }
  return roundMoney(Math.min(promotion.discountValue, sellingSubtotal));
}

function demoCheckoutQuote(
  sellingSubtotal: number,
  itemDiscount: number,
  couponCode: string | null,
): CheckoutQuoteOutput {
  const canonicalItemDiscount = roundMoney(Math.max(0, itemDiscount));
  const subtotal = roundMoney(sellingSubtotal + canonicalItemDiscount);
  const couponDiscount = demoCouponDiscount(couponCode, sellingSubtotal);
  const deliveryFee = demoDeliveryFee(DEMO_ADDRESS);
  const taxable = Math.max(0, sellingSubtotal - couponDiscount);
  const tax = roundMoney(taxable * CHECKOUT_TAX_RATE);
  const payableTotal = roundMoney(taxable + deliveryFee + tax);

  return {
    quoteToken: `DEMO-${Date.now()}`,
    subtotal,
    itemDiscount: canonicalItemDiscount,
    couponDiscount,
    loyaltyDiscount: 0,
    deliveryFee,
    tax,
    roundOff: 0,
    payableTotal,
    couponCode,
    isCodAvailable: true,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

function categoryImage(category: string): string {
  switch (category) {
    case 'food': return DEMO_MEDIA.food;
    case 'treats': return DEMO_MEDIA.treats;
    case 'toys': return DEMO_MEDIA.toys;
    case 'travel': return DEMO_MEDIA.travel;
    case 'furniture': return DEMO_MEDIA.furniture;
    default: return DEMO_MEDIA.store;
  }
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
    items.forEach((item) => {
      quantities.set(item.product.id, (quantities.get(item.product.id) ?? 0) + item.quantity);
    });
    return Array.from(quantities, ([offeringId, quantity]) => ({ offeringId, quantity }));
  }, [items]);

  const itemSubtotal = useMemo(
    () => items.reduce((total, item) => total + item.unitPrice * item.quantity, 0),
    [items],
  );
  const itemSavings = useMemo(
    () => items.reduce((total, item) => {
      const original = item.product.originalPrice ?? item.unitPrice;
      return total + Math.max(0, original - item.unitPrice) * item.quantity;
    }, 0),
    [items],
  );

  const hasPreviewItems = !providerId
    || !UUID_PATTERN.test(providerId)
    || checkoutItems.some((item) => !UUID_PATTERN.test(item.offeringId));
  const demoCheckout = appConfig.allowDemoMode
    && Boolean(providerId)
    && checkoutItems.length > 0
    && hasPreviewItems;

  const [address, setAddress] = useState<CustomerAddress | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>('COD');
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [quote, setQuote] = useState<CheckoutQuoteOutput | null>(null);
  const [pendingOrder, setPendingOrder] = useState<CustomerOrderRecord | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [placing, setPlacing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user || !session || cartLoading) return;
    if (!providerId || checkoutItems.length === 0) {
      setQuote(null);
      setState('ready');
      return;
    }

    if (demoCheckout) {
      setAddress(DEMO_ADDRESS);
      setQuote(demoCheckoutQuote(itemSubtotal, itemSavings, appliedCoupon));
      setPendingOrder(null);
      setState('ready');
      return;
    }

    if (hasPreviewItems) {
      setQuote(null);
      setState('ready');
      return;
    }

    setState('loading');
    try {
      const defaultAddress = await fetchDefaultAddress(session.access_token);
      setAddress(defaultAddress);
      if (defaultAddress) {
        setQuote(await fetchCheckoutQuote({
          customerId: user.id,
          providerId,
          deliveryAddressId: defaultAddress.addressId,
          items: checkoutItems,
          couponCode: appliedCoupon,
          paymentMethod,
          city: defaultAddress.city,
          latitude: defaultAddress.geoLat,
          longitude: defaultAddress.geoLng,
        }, session.access_token));
      }
      setState('ready');
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [appliedCoupon, cartLoading, checkoutItems, demoCheckout, hasPreviewItems, itemSavings, itemSubtotal, paymentMethod, providerId, session, user]);

  useEffect(() => {
    if (user && session) void loadData();
  }, [loadData, session, user]);

  const handleApplyCoupon = () => {
    const code = couponCodeInput.trim().toUpperCase();
    if (!code) return;
    if (demoCheckout && !(code in DEMO_PROMOTIONS)) {
      Alert.alert('Invalid coupon', 'Demo checkout supports DEMO10 and DEMO50 only.');
      return;
    }
    setAppliedCoupon(code);
    setCouponCodeInput('');
  };

  const createOrder = async (): Promise<CustomerOrderRecord> => {
    if (!user || !session || !address || !quote || !providerId) {
      throw new Error('Checkout is not ready.');
    }
    if (pendingOrder) return pendingOrder;

    const created = await createCustomerOrder({
      customerId: user.id,
      providerId,
      deliveryAddressId: address.addressId,
      items: checkoutItems,
      couponCode: appliedCoupon,
      paymentMethod,
      quoteToken: quote.quoteToken,
      city: address.city,
      latitude: address.geoLat,
      longitude: address.geoLng,
    }, session.access_token);
    setPendingOrder(created);
    return created;
  };

  const handlePlaceOrder = async () => {
    if (!user || !session || !address || !quote || !providerId || checkoutItems.length === 0) return;
    if (paymentMethod === 'COD' && !quote.isCodAvailable) {
      Alert.alert('COD unavailable', quote.codRejectionReason || 'Choose UPI or card for this order.');
      return;
    }

    if (demoCheckout) {
      Alert.alert(
        paymentMethod === 'COD' ? 'Demo order simulated' : 'Demo payment simulated',
        `₹${quote.payableTotal.toFixed(2)} was simulated for UI testing only. No backend order was created and no money was charged.`,
      );
      return;
    }

    setPlacing(true);
    try {
      const order = await createOrder();
      if (paymentMethod === 'COD') {
        await clearCart();
        router.replace(`/orders/${order.id}` as never);
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const initialization = await initiateOrderPayment(user.id, order.id, order.rawTotal, {
        phone: user.phone || String(metadata?.phone || metadata?.mobile || ''),
        email: user.email,
        name: String(metadata?.full_name || metadata?.name || '').trim() || null,
      });
      await openCashfreeOrder(initialization);
      const payment = await waitForPaymentOutcome(order.id);

      if (payment.status === 'SUCCESS') {
        await clearCart();
        Alert.alert('Payment confirmed', 'Your payment was confirmed by the MyPet server. The merchant can now accept or reject the order.');
        router.replace(`/orders/${order.id}` as never);
      } else if (payment.status === 'PENDING') {
        Alert.alert(
          'Payment confirmation pending',
          'Cashfree has not confirmed the payment yet. MyPet will reconcile it automatically; you do not need to resubmit the order.',
          [{ text: 'View order', onPress: () => router.replace(`/orders/${order.id}` as never) }],
        );
      } else {
        Alert.alert('Payment not completed', 'The server marked this payment failed or expired. Reserved stock and discounts will be released automatically.');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not complete checkout.';
      Alert.alert('Checkout failed', message);
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
        <StateView
          kind="loading"
          title={t('states.loading')}
          message={demoCheckout ? 'Preparing the safe demo checkout…' : 'Fetching the server-authoritative total…'}
        />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind={state}
          title={state === 'offline' ? t('states.offline') : t('states.error')}
          message={state === 'offline' ? t('states.offlineMessage') : t('states.errorMessage')}
          actionLabel={t('states.retry')}
          onAction={() => void loadData()}
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

  if (!address) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="error"
          title="Delivery address required"
          message="Add a valid default address before checkout."
          actionLabel="Go to profile"
          onAction={() => router.push('/(tabs)/profile' as never)}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      header={(
        <AppBar
          title={t('routes.checkout')}
          subtitle={demoCheckout ? 'Safe demo payment review' : 'Secure server-authoritative checkout'}
        />
      )}
    >
      <View style={styles.container}>
        {demoCheckout ? (
          <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
            <StatusBadge label="DEMO CHECKOUT" tone="warning" />
            <ThemedText type="small" themeColor="textSecondary">
              Development simulation only. No order is sent to the backend and no payment is charged. Pricing rules are identical to production.
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.headerRow}>
            <AppIcon name="location" size={18} color={theme.primary} />
            <ThemedText style={styles.cardTitle}>Delivery address</ThemedText>
            <StatusBadge label={address.label || 'Default'} tone="success" />
          </View>
          <ThemedText>{address.line1}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {address.city}, {address.state} – {address.pincode}
          </ThemedText>
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.headerRow}>
            <ThemedText style={styles.cardTitle}>Order items</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {items.reduce((sum, item) => sum + item.quantity, 0)} items
            </ThemedText>
          </View>
          {items.map((item) => (
            <View key={`${item.product.id}-${item.selectedVariant?.id ?? 'default'}`} style={styles.itemRow}>
              <View style={[styles.itemImageWrap, { backgroundColor: theme.muted }]}>
                <ResilientRemoteImage uri={item.product.imageUrl} fallbackUri={categoryImage(item.product.category)} style={styles.itemImage} />
              </View>
              <View style={styles.itemCopy}>
                <ThemedText style={styles.itemName} numberOfLines={2}>{item.product.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {item.selectedVariant?.name ?? 'Standard'} · Qty {item.quantity}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">₹{item.unitPrice.toFixed(2)} × {item.quantity}</ThemedText>
              </View>
              <ThemedText style={styles.lineTotal}>₹{(item.unitPrice * item.quantity).toFixed(2)}</ThemedText>
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <PriceRow label="Item subtotal" value={itemSubtotal} />
          {itemSavings > 0 ? <PriceRow label="Product savings" value={-itemSavings} /> : null}
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Payment method</ThemedText>
          <View style={styles.methodRow}>
            {PAYMENT_METHODS.map((method) => {
              const selected = paymentMethod === method.id;
              return (
                <Pressable
                  key={method.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => { setPaymentMethod(method.id); setPendingOrder(null); }}
                  style={[
                    styles.method,
                    {
                      borderColor: selected ? theme.primary : theme.border,
                      backgroundColor: selected ? theme.primarySoft : theme.background,
                    },
                  ]}
                >
                  <ThemedText style={{ fontWeight: '700', color: selected ? theme.primary : theme.text }}>{method.label}</ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {demoCheckout
              ? 'Payment method selection is simulated in demo mode; no gateway will be opened.'
              : 'Online payment success is accepted only after Cashfree webhook verification.'}
          </ThemedText>
          {paymentMethod === 'COD' && quote && !quote.isCodAvailable ? (
            <View style={styles.warningRow}>
              <AppIcon name="warning" size={16} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>{quote.codRejectionReason || 'COD is unavailable for this order.'}</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Coupon</ThemedText>
          {appliedCoupon ? (
            <View style={styles.headerRow}>
              <StatusBadge label={`${appliedCoupon} applied`} tone="success" />
              <Pressable onPress={() => setAppliedCoupon(null)}>
                <ThemedText style={{ color: theme.danger, fontWeight: '700' }}>Remove</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.couponRow}>
              <TextInput
                value={couponCodeInput}
                onChangeText={setCouponCodeInput}
                placeholder={demoCheckout ? 'Try DEMO10 or DEMO50' : 'Enter coupon code'}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable style={[styles.applyButton, { backgroundColor: theme.primary }]} onPress={handleApplyCoupon}>
                <ThemedText style={styles.applyText}>Apply</ThemedText>
              </Pressable>
            </View>
          )}
        </View>

        {quote ? (
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.cardTitle}>Final payment breakdown</ThemedText>
            <PriceRow label="Products" value={quote.subtotal} />
            {quote.itemDiscount > 0 ? <PriceRow label="Item discount" value={-quote.itemDiscount} /> : null}
            {quote.couponDiscount > 0 ? <PriceRow label="Coupon discount" value={-quote.couponDiscount} /> : null}
            {quote.loyaltyDiscount > 0 ? <PriceRow label="Loyalty discount" value={-quote.loyaltyDiscount} /> : null}
            <PriceRow label="Delivery fee" value={quote.deliveryFee} />
            <PriceRow label="Tax" value={quote.tax} />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.headerRow}>
              <ThemedText style={styles.totalLabel}>Payable total</ThemedText>
              <ThemedText style={[styles.totalValue, { color: theme.primary }]}>₹{quote.payableTotal.toFixed(2)}</ThemedText>
            </View>
          </View>
        ) : null}

        {pendingOrder && paymentMethod !== 'COD' ? (
          <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
            <ThemedText style={{ fontWeight: '700' }}>Payment retry for order #{pendingOrder.id.slice(0, 8)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Retrying reuses the existing order and does not reserve stock twice.</ThemedText>
          </View>
        ) : null}

        <PrimaryAction
          label={demoCheckout
            ? `Simulate ${paymentMethod} · ₹${quote?.payableTotal.toFixed(2) ?? '0.00'}`
            : paymentMethod === 'COD'
              ? 'Place COD order'
              : `Pay ₹${quote?.payableTotal.toFixed(2) ?? '0.00'} securely`}
          onPress={() => void handlePlaceOrder()}
          loading={placing}
        />
      </View>
    </ScreenShell>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.headerRow}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText style={styles.priceValue}>{value < 0 ? '-' : ''}₹{Math.abs(value).toFixed(2)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  cardTitle: { ...typography.label, fontWeight: '700' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  itemImageWrap: { width: 58, height: 58, borderRadius: radii.compact, overflow: 'hidden' },
  itemImage: { width: '100%', height: '100%' },
  itemCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontWeight: '700', fontSize: 13, lineHeight: 18 },
  lineTotal: { fontWeight: '800' },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  method: { borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2 },
  warningRow: { flexDirection: 'row', gap: spacing.x2, alignItems: 'flex-start' },
  couponRow: { flexDirection: 'row', gap: spacing.x2 },
  input: { flex: 1, height: 42, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x3 },
  applyButton: { minWidth: 76, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#fff', fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  priceValue: { fontWeight: '700' },
  totalLabel: { ...typography.label, fontWeight: '800' },
  totalValue: { ...typography.title, fontWeight: '800' },
  notice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1 },
});
