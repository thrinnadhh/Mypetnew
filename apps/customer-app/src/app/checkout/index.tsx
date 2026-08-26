import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import type { CustomerPaymentMethod } from '@/contracts/customer-payment';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useCart } from '@/context/CartContext';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  buildCheckoutRequestKey,
  checkoutErrorPresentation,
  hasServerPriceChange,
  isQuoteExpired,
  requiresFreshQuote,
  type CheckoutRecovery,
} from '@/services/checkout-safety';
import { createProductOrder, type ProductFulfilmentMode } from '@/services/customer-checkout';
import {
  clearPendingPayment,
  fetchPaymentStatus,
  initiateOrderPayment,
  loadPendingPayment,
  openCashfreeOrder,
  validateCanonicalPayment,
  waitForPaymentOutcome,
  type CustomerPaymentView,
  type PendingPaymentRecovery,
} from '@/services/customer-payments';
import {
  fetchCaptainDeliveryQuote,
  fetchPickupQuote,
  type CanonicalProductQuote,
} from '@/services/customer-quotes';
import {
  checkOutletServiceability,
  fetchCustomerAddresses,
  type CustomerAddress,
} from '@/services/customer-profile';
import { appConfig } from '@/utils/app-config';
import { isUuid } from '@/utils/uuid';
const PIN_PATTERN = /^[1-9][0-9]{5}$/;

type CheckoutViewQuote = {
  quoteId: string;
  cartSignature: string;
  requestKey: string;
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
  lineUnitPrices: Record<string, number>;
};

type FulfilmentAvailability = {
  pickup: boolean;
  delivery: boolean;
};

function quoteToView(quote: CanonicalProductQuote, requestKey: string): CheckoutViewQuote {
  const rupees = (paise: number) => paise / 100;
  return {
    quoteId: quote.id,
    cartSignature: quote.cartSignature,
    requestKey,
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
    lineUnitPrices: Object.fromEntries(
      Object.entries(quote.lines).map(([listingId, line]) => [listingId, rupees(line[1])]),
    ),
  };
}

function demoQuote(subtotal: number, requestKey: string): CheckoutViewQuote {
  return {
    quoteId: `DEMO-${Date.now()}`,
    cartSignature: 'demo-signature',
    requestKey,
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
    lineUnitPrices: {},
  };
}

export default function CheckoutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { items, providerId, clearCart, loading: cartLoading } = useCart();
  const {
    selectedPincode,
    loading: locationLoading,
    openLocationModal,
  } = useLocation();
  const quoteGenerationRef = useRef(0);

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
    || !isUuid(providerId)
    || checkoutItems.some((item) => !isUuid(item.offeringId));
  const demoCheckout = appConfig.allowDemoMode && Boolean(providerId) && checkoutItems.length > 0 && hasPreviewItems;

  const [fulfilmentMode, setFulfilmentMode] = useState<ProductFulfilmentMode>('STORE_PICKUP');
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>('PAY_ON_FULFILMENT');
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<FulfilmentAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [quote, setQuote] = useState<CheckoutViewQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [quoteRecovery, setQuoteRecovery] = useState<CheckoutRecovery>('retry');
  const [placing, setPlacing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<PendingPaymentRecovery | null>(null);

  const selectedAddress = useMemo(
    () => addresses.find((address) => address.addressId === selectedAddressId) ?? null,
    [addresses, selectedAddressId],
  );
  const selectedAddressMatchesPin = !selectedAddress || selectedAddress.pincode === selectedPincode;

  const quoteRequestKey = useMemo(() => buildCheckoutRequestKey({
    customerId: user?.id ?? '',
    providerId: providerId ?? '',
    lines: checkoutItems,
    fulfilmentMode,
    paymentMethod,
    selectedAddressId,
    selectedPincode,
  }), [checkoutItems, fulfilmentMode, paymentMethod, providerId, selectedAddressId, selectedPincode, user?.id]);

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

  useEffect(() => {
    if (!user || !session || cartLoading || locationLoading || !providerId || checkoutItems.length === 0 || hasPreviewItems) {
      setAvailability(demoCheckout ? { pickup: true, delivery: false } : null);
      setAvailabilityError(null);
      return;
    }
    if (!PIN_PATTERN.test(selectedPincode)) {
      setAvailability({ pickup: false, delivery: false });
      setAvailabilityError(null);
      return;
    }

    let active = true;
    setAvailability(null);
    setAvailabilityError(null);
    void Promise.all([
      checkOutletServiceability(providerId, selectedPincode, 'PICKUP'),
      checkOutletServiceability(providerId, selectedPincode, 'DELIVERY'),
    ]).then(([pickup, delivery]) => {
      if (!active) return;
      setAvailability({ pickup: pickup.serviceable, delivery: delivery.serviceable });
      setAvailabilityError(null);
      setErrorMessage(null);
      setState('ready');
    }).catch((error) => {
      if (!active) return;
      const presentation = checkoutErrorPresentation(error);
      setAvailability({ pickup: false, delivery: false });
      setAvailabilityError(presentation.message);
      setErrorMessage(presentation.message);
      setQuoteRecovery('retry');
      setState('error');
    });
    return () => { active = false; };
  }, [availabilityRetry, cartLoading, checkoutItems.length, demoCheckout, hasPreviewItems, locationLoading, providerId, selectedPincode, session, user]);

  useEffect(() => {
    if (!availability) return;
    if (fulfilmentMode === 'STORE_PICKUP' && !availability.pickup && availability.delivery) {
      setFulfilmentMode('MYPET_CAPTAIN_DELIVERY');
    } else if (fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' && !availability.delivery && availability.pickup) {
      setFulfilmentMode('STORE_PICKUP');
    }
  }, [availability, fulfilmentMode]);

  const loadQuote = useCallback(async () => {
    const requestGeneration = ++quoteGenerationRef.current;
    if (!user || !session || cartLoading || locationLoading) return;
    if (!providerId || checkoutItems.length === 0) {
      setQuote(null);
      setState('ready');
      return;
    }
    if (demoCheckout) {
      setFulfilmentMode('STORE_PICKUP');
      setQuote(demoQuote(itemSubtotal, quoteRequestKey));
      setErrorMessage(null);
      setQuoteRecovery('retry');
      setState('ready');
      return;
    }
    if (hasPreviewItems) {
      setQuote(null);
      setErrorMessage(null);
      setState('ready');
      return;
    }
    if (!PIN_PATTERN.test(selectedPincode) || !availability) {
      setQuote(null);
      setState('ready');
      return;
    }
    const modeAvailable = fulfilmentMode === 'STORE_PICKUP' ? availability.pickup : availability.delivery;
    if (!modeAvailable) {
      setQuote(null);
      setState('ready');
      return;
    }
    if (fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' && (!selectedAddressId || !selectedAddressMatchesPin)) {
      setQuote(null);
      setErrorMessage(null);
      setState('ready');
      return;
    }

    setState('loading');
    setErrorMessage(null);
    setQuoteRecovery('retry');
    try {
      const lines = checkoutItems.map((item) => ({ listingId: item.offeringId, quantity: item.quantity }));
      const canonical = fulfilmentMode === 'STORE_PICKUP'
        ? await fetchPickupQuote(providerId, lines, paymentMethod)
        : await fetchCaptainDeliveryQuote(providerId, selectedAddressId as string, lines, paymentMethod);
      if (requestGeneration !== quoteGenerationRef.current) return;
      setQuote(quoteToView(canonical, quoteRequestKey));
      setState('ready');
    } catch (error) {
      if (requestGeneration !== quoteGenerationRef.current) return;
      const presentation = checkoutErrorPresentation(error);
      setQuote(null);
      setErrorMessage(presentation.message);
      setQuoteRecovery(presentation.recovery);
      setState('error');
    }
  }, [availability, cartLoading, checkoutItems, demoCheckout, fulfilmentMode, hasPreviewItems, itemSubtotal, locationLoading, paymentMethod, providerId, quoteRequestKey, selectedAddressId, selectedAddressMatchesPin, selectedPincode, session, user]);

  useEffect(() => {
    if (user && session && !availabilityError && (demoCheckout || availability)) void loadQuote();
  }, [availability, availabilityError, demoCheckout, loadQuote, session, user]);

  useEffect(() => {
    if (!quote || demoCheckout) return;
    const expiresAt = Date.parse(quote.expiresAt);
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remaining <= 0) {
      setQuote(null);
      setErrorMessage('This checkout quote expired. Request a fresh server quote and review the total before ordering.');
      setQuoteRecovery('retry');
      setState('error');
      return;
    }
    const timer = setTimeout(() => {
      setQuote((current) => current?.quoteId === quote.quoteId ? null : current);
      setErrorMessage('This checkout quote expired. Request a fresh server quote and review the total before ordering.');
      setQuoteRecovery('retry');
      setState('error');
    }, remaining);
    return () => clearTimeout(timer);
  }, [demoCheckout, quote]);

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
      validateCanonicalPayment(initial, {
        expectedPaymentId: initial.paymentId,
        referenceType: 'PRODUCT_ORDER',
        referenceId: orderId,
      });
      if (launchProvider && initial.status !== 'CAPTURED' && initial.paymentSessionId) {
        // The callback result is deliberately ignored as payment truth. Both
        // success and error callbacks flow into the same backend verification.
        await openCashfreeOrder(initial).catch(() => 'ERROR' as const);
      }
      const finalPayment = initial.status === 'CAPTURED'
        ? initial
        : await waitForPaymentOutcome(initial.paymentId, undefined, undefined, undefined, {
          referenceType: 'PRODUCT_ORDER',
          referenceId: orderId,
        });
      await finishVerifiedPayment(finalPayment, orderId);
    } finally {
      setVerifying(false);
    }
  }, [finishVerifiedPayment]);

  const handleResumePayment = async () => {
    if (!pendingRecovery || placing) return;
    setPlacing(true);
    try {
      const payment = await fetchPaymentStatus(pendingRecovery.paymentId, {
        referenceType: 'PRODUCT_ORDER',
        referenceId: pendingRecovery.orderId,
      });
      await verifyCanonicalPayment(payment, pendingRecovery.orderId, true);
    } catch (error) {
      Alert.alert('Could not resume payment', error instanceof Error ? error.message : 'Try again shortly.');
    } finally {
      setPlacing(false);
    }
  };

  const quoteCurrent = Boolean(
    quote &&
    quote.requestKey === quoteRequestKey &&
    !isQuoteExpired(quote.expiresAt),
  );
  const activeQuote = quoteCurrent ? quote : null;
  const priceChanged = activeQuote
    ? hasServerPriceChange(itemSubtotal, Math.round(activeQuote.subtotal * 100))
    : false;

  const handlePlaceOrder = async () => {
    if (!session || !activeQuote || !providerId || checkoutItems.length === 0 || placing) return;
    if (demoCheckout) {
      Alert.alert('Demo pickup simulated', `₹${activeQuote.payableTotal.toFixed(2)} was simulated. No backend order was created.`);
      return;
    }
    if (isQuoteExpired(activeQuote.expiresAt)) {
      await loadQuote();
      Alert.alert('Quote expired', 'A fresh server quote was requested. Review the new total before placing the order.');
      return;
    }
    if (fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' && !selectedAddressMatchesPin) {
      Alert.alert('Service PIN mismatch', 'Choose a delivery address that matches the active service PIN before requesting delivery.');
      return;
    }

    setPlacing(true);
    try {
      const order = await createProductOrder(
        { quoteId: activeQuote.quoteId, cartSignature: activeQuote.cartSignature },
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
      const presentation = checkoutErrorPresentation(error);
      if (requiresFreshQuote(error)) {
        await loadQuote();
        Alert.alert(
          'Checkout changed',
          `${presentation.message} A fresh server quote was requested. Review it before tapping Place Order again.`,
        );
      } else {
        Alert.alert(
          'Checkout failed',
          `${presentation.message} Your current quote is preserved so a retry reuses the same idempotent order request.`,
        );
      }
    } finally {
      setPlacing(false);
    }
  };

  const recoverQuote = () => {
    switch (quoteRecovery) {
      case 'cart':
        router.push('/cart' as never);
        break;
      case 'address':
        openLocationModal();
        break;
      case 'fulfilment':
        if (availability?.pickup) setFulfilmentMode('STORE_PICKUP');
        else openLocationModal();
        break;
      case 'payment':
        setPaymentMethod('PAY_ON_FULFILMENT');
        break;
      default:
        if (availabilityError) {
          setState('loading');
          setAvailabilityRetry((current) => current + 1);
        } else {
          void loadQuote();
        }
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

  if (locationLoading || state === 'loading' || cartLoading || (!demoCheckout && !hasPreviewItems && providerId && !availability)) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView kind="loading" title={t('states.loading')} message="Checking fulfilment, authoritative price and stock…" />
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

  if (!demoCheckout && !PIN_PATTERN.test(selectedPincode)) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="error"
          title="Service PIN required"
          message="Select an active six-digit service PIN before checkout. Pickup remains independent of delivery PIN eligibility, but checkout still needs a canonical service context."
          actionLabel="Choose service PIN"
          onAction={openLocationModal}
        />
      </ScreenShell>
    );
  }

  if (!demoCheckout && availability && !availability.pickup && !availability.delivery && !availabilityError) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="error"
          title="No fulfilment available"
          message="This provider cannot fulfil the cart for the selected service context."
          actionLabel="Change service PIN"
          onAction={openLocationModal}
        />
      </ScreenShell>
    );
  }

  if (state === 'error') {
    const actionLabel = quoteRecovery === 'cart'
      ? 'Review cart'
      : quoteRecovery === 'address'
        ? 'Change service PIN'
        : quoteRecovery === 'fulfilment'
          ? 'Use available fulfilment'
          : quoteRecovery === 'payment'
            ? 'Use pay on fulfilment'
            : availabilityError
              ? 'Retry fulfilment check'
              : 'Request fresh quote';
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.checkout')} />}>
        <StateView
          kind="error"
          title={availabilityError ? 'Checkout requires a connection' : 'Checkout unavailable'}
          message={errorMessage ?? 'Could not load checkout.'}
          actionLabel={actionLabel}
          onAction={recoverQuote}
        />
      </ScreenShell>
    );
  }

  const isDelivery = fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY';
  const isOnline = paymentMethod === 'ONLINE_PAYMENT';
  const pickupAvailable = demoCheckout || availability?.pickup === true;
  const deliveryAvailable = !demoCheckout && availability?.delivery === true;

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

        {priceChanged && activeQuote ? (
          <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
            <StatusBadge label="PRICE UPDATED" tone="warning" />
            <ThemedText type="small" themeColor="textSecondary">
              Cart estimate ₹{itemSubtotal.toFixed(2)} changed to the current server product subtotal ₹{activeQuote.subtotal.toFixed(2)}. Review the updated prices and total before ordering.
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.row}>
            <ThemedText style={styles.cardTitle}>Fulfilment</ThemedText>
            {!demoCheckout ? <StatusBadge label={`SERVICE PIN ${selectedPincode}`} /> : null}
          </View>
          <View style={styles.modeRow}>
            {pickupAvailable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Store pickup"
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
            ) : null}
            {deliveryAvailable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="MyPet Captain delivery"
                accessibilityState={{ selected: isDelivery }}
                onPress={() => setFulfilmentMode('MYPET_CAPTAIN_DELIVERY')}
                style={[
                  styles.modeOption,
                  { borderColor: isDelivery ? theme.primary : theme.border, backgroundColor: isDelivery ? theme.primarySoft : theme.backgroundElement },
                ]}
              >
                <ThemedText style={styles.modeTitle}>Captain delivery</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Server-checked PIN and dispatch eligibility.</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>

        {isDelivery ? (
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.row}>
              <ThemedText style={styles.cardTitle}>Delivery address</ThemedText>
              {selectedAddress && selectedAddressMatchesPin ? <StatusBadge label="PIN MATCH" tone="success" /> : null}
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
                    accessibilityLabel={`${address.label}, PIN ${address.pincode}`}
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
            {selectedAddress && !selectedAddressMatchesPin ? (
              <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
                <StatusBadge label="SERVICE PIN MISMATCH" tone="warning" />
                <ThemedText type="small" themeColor="textSecondary">
                  This address uses PIN {selectedAddress.pincode}, while discovery and checkout are scoped to {selectedPincode}. Change the active service PIN or select a matching address before quoting delivery.
                </ThemedText>
                <PrimaryAction label="Change service PIN" onPress={openLocationModal} />
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Payment</ThemedText>
          <View style={styles.modeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pay on fulfilment"
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
              accessibilityLabel="Pay online"
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
          {items.map((item) => {
            const serverUnitPrice = activeQuote?.lineUnitPrices[item.product.id];
            const unitPrice = serverUnitPrice ?? item.unitPrice;
            const unitPriceChanged = serverUnitPrice !== undefined && Math.round(serverUnitPrice * 100) !== Math.round(item.unitPrice * 100);
            return (
              <View key={`${item.product.id}-${item.selectedVariant?.id ?? 'default'}`} style={styles.row}>
                <View style={styles.itemCopy}>
                  <ThemedText style={styles.itemName}>{item.product.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Qty {item.quantity}{unitPriceChanged ? ` · server price ₹${unitPrice.toFixed(2)} each` : ''}
                  </ThemedText>
                </View>
                <ThemedText style={styles.price}>₹{(unitPrice * item.quantity).toFixed(2)}</ThemedText>
              </View>
            );
          })}
        </View>

        {activeQuote ? (
          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.cardTitle}>Server-authoritative total</ThemedText>
            <PriceRow label="Products" value={activeQuote.subtotal} />
            {activeQuote.itemDiscount > 0 ? <PriceRow label="Item discount" value={-activeQuote.itemDiscount} /> : null}
            {activeQuote.couponDiscount > 0 ? <PriceRow label="Coupon discount" value={-activeQuote.couponDiscount} /> : null}
            {activeQuote.loyaltyDiscount > 0 ? <PriceRow label="Loyalty reward" value={-activeQuote.loyaltyDiscount} /> : null}
            {activeQuote.platformFee ? <PriceRow label="Platform fee" value={activeQuote.platformFee} /> : null}
            <PriceRow label="Delivery fee" value={activeQuote.deliveryFee} />
            <PriceRow label="Tax" value={activeQuote.tax} />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.row}>
              <ThemedText style={styles.totalLabel}>{isOnline ? 'Pay online' : 'Pay on fulfilment'}</ThemedText>
              <ThemedText style={[styles.totalValue, { color: theme.primary }]}>₹{activeQuote.payableTotal.toFixed(2)}</ThemedText>
            </View>
          </View>
        ) : null}

        <PrimaryAction
          label={demoCheckout
            ? `Simulate pickup · ₹${activeQuote?.payableTotal.toFixed(2) ?? '0.00'}`
            : isOnline
              ? `Continue to secure payment · ₹${activeQuote?.payableTotal.toFixed(2) ?? '0.00'}`
              : isDelivery
                ? `Place delivery order · ₹${activeQuote?.payableTotal.toFixed(2) ?? '0.00'}`
                : 'Place pickup order'}
          onPress={() => void handlePlaceOrder()}
          loading={placing}
          disabled={!activeQuote || Boolean(pendingRecovery) || (isDelivery && (!selectedAddressId || !selectedAddressMatchesPin))}
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
