import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/app-icon';
import { StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { stockForCartLine, useCart } from '@/context/CartContext';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { revalidateCartItemsAgainstCatalog } from '@/services/cart-revalidation';
import { isOfflineError } from '@/services/customer-profile';

function money(value: number): string {
  return Number.isInteger(value) ? `₹${value}` : `₹${value.toFixed(2)}`;
}

export default function CartScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { selectedPincode } = useLocation();
  const {
    items,
    providerName,
    subtotalAmount,
    totalItemsCount,
    loading,
    updateQuantity,
    removeFromCart,
    clearCart,
    replaceCart,
  } = useCart();
  const [checkingCart, setCheckingCart] = useState(false);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/products' as never);
  }, [router]);

  const continueShopping = useCallback(() => {
    router.push('/products' as never);
  }, [router]);

  const handleCheckoutProceed = useCallback(async () => {
    if (checkingCart || items.length === 0) return;
    setCheckingCart(true);
    setCartNotice(null);
    setRefreshError(null);

    try {
      const result = await revalidateCartItemsAgainstCatalog(items, selectedPincode);
      await replaceCart(result.items);

      if (result.materialChanged) {
        const changes = [
          result.removedCount > 0 ? `${result.removedCount} unavailable item${result.removedCount === 1 ? '' : 's'} removed` : null,
          result.priceChangedCount > 0 ? `${result.priceChangedCount} price update${result.priceChangedCount === 1 ? '' : 's'}` : null,
          result.quantityChangedCount > 0 ? `${result.quantityChangedCount} quantity adjustment${result.quantityChangedCount === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(', ');
        setCartNotice(`Cart refreshed: ${changes}. Review the current item subtotal before continuing.`);
        return;
      }

      router.push('/checkout' as never);
    } catch (error) {
      const message = isOfflineError(error)
        ? 'You are offline. Reconnect to refresh current price, stock, and serviceability before checkout.'
        : error instanceof Error
          ? error.message
          : 'Could not refresh the cart. Your existing cart was kept unchanged.';
      setRefreshError(message);
    } finally {
      setCheckingCart(false);
    }
  }, [checkingCart, items, replaceCart, router, selectedPincode]);

  if (loading) {
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title="My Cart" subtitle="Restoring your saved cart" onBack={goBack} />}
        testID="cart-screen"
      >
        <StateView kind="loading" title="Loading cart" message="Restoring your saved items safely." />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      scroll={false}
      header={(
        <ScreenHeader
          title="My Cart"
          subtitle={providerName ? `Ordering from ${providerName}` : 'Your selected pet items'}
          onBack={goBack}
          trailing={
            items.length > 0 ? (
              <Pressable
                onPress={() => {
                  Alert.alert('Clear cart?', 'Remove every item from this cart?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear Cart', style: 'destructive', onPress: () => { void clearCart(); } },
                  ]);
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear cart"
                style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
              >
                <ThemedText style={{ color: theme.danger, fontWeight: '700', fontSize: 13 }}>Clear Cart</ThemedText>
              </Pressable>
            ) : undefined
          }
        />
      )}
      footer={
        items.length > 0 ? (
          <View
            style={[
              styles.checkoutBox,
              shadows.raised,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, paddingBottom: Math.max(spacing.x4, insets.bottom + spacing.x2) },
            ]}
          >
            {cartNotice ? (
              <ThemedText type="small" style={{ color: theme.warning }} accessibilityLiveRegion="polite">
                {cartNotice}
              </ThemedText>
            ) : null}
            {refreshError ? (
              <ThemedText type="small" style={{ color: theme.danger }} accessibilityLiveRegion="assertive">
                {refreshError}
              </ThemedText>
            ) : null}
            <View style={styles.summaryRow}>
              <View style={styles.summaryCopy}>
                <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>Current item subtotal</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {totalItemsCount} item{totalItemsCount === 1 ? '' : 's'} · projection only
                </ThemedText>
              </View>
              <ThemedText style={{ color: theme.primary, fontWeight: '900', fontSize: 20 }}>{money(subtotalAmount)}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.quoteBoundaryText}>
              Delivery, platform fee, tax, discounts and the final payable amount are calculated by the authoritative checkout quote.
            </ThemedText>
            <View style={styles.footerActions}>
              <PrimaryButton label="Continue shopping" variant="secondary" onPress={continueShopping} style={styles.footerButton} />
              <PrimaryButton
                label="Proceed to Checkout →"
                loading={checkingCart}
                onPress={() => { void handleCheckoutProceed(); }}
                style={styles.footerButton}
              />
            </View>
          </View>
        ) : undefined
      }
      contentContainerStyle={styles.content}
      testID="cart-screen"
    >
      {items.length === 0 ? (
        <StateView
          kind="empty"
          title="Your cart is empty"
          message="Browse live products from verified local stores to start a single-store cart."
          actionLabel="Browse products"
          onAction={() => router.replace('/products' as never)}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.product.id}-${item.selectedVariant?.id ?? 'default'}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const maxStock = stockForCartLine(item.product, item.selectedVariant);
            const atKnownMax = item.quantity >= maxStock;
            return (
              <View style={[styles.cartItemCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ResilientRemoteImage
                  uri={item.product.imageUrl}
                  accessibilityLabel={`${item.product.name} product image`}
                  style={styles.itemImage}
                  contentFit="cover"
                />

                <View style={styles.itemCopy}>
                  {item.product.brand ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.product.brand}</ThemedText>
                  ) : null}
                  <ThemedText style={[styles.itemTitle, { color: theme.text }]} numberOfLines={2}>
                    {item.product.name}
                  </ThemedText>
                  {item.selectedVariant ? <StatusBadge label={item.selectedVariant.name} color={theme.primary} /> : null}
                  <ThemedText style={{ fontWeight: '800', fontSize: 15, color: theme.primary }}>
                    {money(item.unitPrice * item.quantity)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {money(item.unitPrice)} each · latest known stock {maxStock}
                  </ThemedText>
                </View>

                <View style={styles.actionCol}>
                  <Pressable
                    onPress={() => removeFromCart(item.product.id, item.selectedVariant?.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.product.name} from cart`}
                    style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                  >
                    <AppIcon name="close" color={theme.textSecondary} size={18} />
                  </Pressable>

                  <View
                    style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}
                    accessibilityRole="adjustable"
                    accessibilityLabel={`${item.product.name} quantity`}
                    accessibilityValue={{ min: 1, max: maxStock, now: item.quantity }}
                  >
                    <Pressable
                      onPress={() => updateQuantity(item.product.id, item.selectedVariant?.id, item.quantity - 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease ${item.product.name} quantity`}
                      style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
                    >
                      <ThemedText style={{ color: theme.primary, fontWeight: '800', fontSize: 18 }}>−</ThemedText>
                    </Pressable>
                    <ThemedText style={[styles.quantity, { color: theme.primary }]}>{item.quantity}</ThemedText>
                    <Pressable
                      onPress={() => updateQuantity(item.product.id, item.selectedVariant?.id, item.quantity + 1)}
                      disabled={atKnownMax}
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${item.product.name} quantity`}
                      accessibilityState={{ disabled: atKnownMax }}
                      style={({ pressed }) => [styles.stepBtn, atKnownMax && styles.disabled, pressed && !atKnownMax && styles.pressed]}
                    >
                      <ThemedText style={{ color: theme.primary, fontWeight: '800', fontSize: 18 }}>+</ThemedText>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.x4, paddingTop: spacing.x3 },
  headerAction: { minWidth: touchTarget, minHeight: touchTarget, paddingHorizontal: spacing.x2, alignItems: 'center', justifyContent: 'center' },
  listContent: { gap: spacing.x3, paddingBottom: spacing.x4 },
  cartItemCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.x3, borderRadius: radii.card, borderWidth: 1, gap: spacing.x3 },
  itemImage: { width: 76, height: 76, borderRadius: radii.compact },
  itemCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  itemTitle: { ...typography.headline, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  actionCol: { justifyContent: 'space-between', alignItems: 'flex-end', alignSelf: 'stretch', minHeight: 76, gap: spacing.x2 },
  removeButton: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.pill, minHeight: touchTarget },
  stepBtn: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  quantity: { minWidth: 28, textAlign: 'center', fontWeight: '800' },
  checkoutBox: { borderTopWidth: 1, paddingHorizontal: spacing.x4, paddingTop: spacing.x3, paddingBottom: spacing.x4, gap: spacing.x2 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  summaryCopy: { flex: 1, gap: 2 },
  quoteBoundaryText: { lineHeight: 18 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  footerButton: { flexGrow: 1, flexBasis: 160 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
});
