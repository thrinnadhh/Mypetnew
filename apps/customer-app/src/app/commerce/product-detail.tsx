import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { useFavourites } from '@/context/FavouritesContext';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CommerceProduct, ProductVariant } from '@/services/catalog-data';
import { isCommerceEligible } from '@/services/commerce-eligibility';
import { isOfflineError } from '@/services/customer-profile';
import { fetchServiceableCommerceProduct } from '@/services/paginated-catalog';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ProductDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = single(params.id);
  const router = useRouter();
  const theme = useTheme();
  const { selectedPincode } = useLocation();
  const { addToCart, items, updateQuantity } = useCart();
  const { isFavourite, toggleFavourite } = useFavourites();
  const [product, setProduct] = useState<CommerceProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/products' as never);
  }, [router]);

  const load = useCallback(async () => {
    if (!id || !/^[1-9][0-9]{5}$/.test(selectedPincode)) {
      setProduct(null);
      setSelectedVariant(null);
      setState('error');
      return;
    }

    setState('loading');
    try {
      const nextProduct = await fetchServiceableCommerceProduct(id, selectedPincode);
      setProduct(nextProduct);
      setSelectedVariant(
        nextProduct.variants.find((variant) => variant.inStock && variant.stockCount > 0)
          ?? nextProduct.variants[0]
          ?? null,
      );
      setState('ready');
    } catch (error) {
      setProduct(null);
      setSelectedVariant(null);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [id, selectedPincode]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title="Product" subtitle={`Loading live price and stock for PIN ${selectedPincode}`} onBack={goBack} />}
        testID="product-detail-screen"
      >
        <StateView kind="loading" title="Loading product" message="Checking current price, variants and store stock." />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error' || !product || !selectedVariant) {
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title="Product" subtitle={`Service PIN ${selectedPincode}`} onBack={goBack} />}
        testID="product-detail-screen"
      >
        <StateView
          kind={state === 'offline' ? 'offline' : 'error'}
          title={state === 'offline' ? 'You are offline' : 'Product unavailable'}
          message={
            state === 'offline'
              ? 'Reconnect to verify the latest price and stock.'
              : `This product is unavailable from an active store serving PIN ${selectedPincode}, or its purchasable variants are no longer available.`
          }
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  const favourite = isFavourite('PRODUCT', product.id);
  const cartItem = items.find(
    (item) => item.product.id === product.id && item.selectedVariant?.id === selectedVariant.id,
  );
  const quantity = cartItem?.quantity ?? 0;
  const currentPrice = selectedVariant.price;
  const currentOriginalPrice = selectedVariant.originalPrice ?? product.originalPrice;
  const viewOnly = product.kind === 'MEDICINE' || product.commerceMode === 'VIEW_ONLY';
  const pickupDisabled = product.pickupEnabled === false;
  const variantOutOfStock = !selectedVariant.inStock || selectedVariant.stockCount <= 0;
  const productOutOfStock = product.availableQuantity !== undefined && product.availableQuantity <= 0;
  const canPurchase = isCommerceEligible(product) && !variantOutOfStock && !productOutOfStock;

  const footerLabel = viewOnly
    ? 'View only — online purchase is unavailable'
    : pickupDisabled
      ? 'Pickup unavailable'
      : variantOutOfStock || productOutOfStock
        ? 'Out of stock'
        : 'Unavailable';

  return (
    <ScreenShell
      header={<ScreenHeader title={product.brand || 'Product'} subtitle={product.name} onBack={goBack} />}
      footer={(
        <View style={[styles.footer, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.footerPriceBlock}>
            <ThemedText type="small" themeColor="textSecondary">Total price</ThemedText>
            <ThemedText style={[styles.footerPrice, { color: theme.primary }]}>₹{currentPrice * Math.max(quantity, 1)}</ThemedText>
          </View>
          {canPurchase ? (
            quantity > 0 ? (
              <View
                style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}
                accessibilityRole="adjustable"
                accessibilityLabel={`${product.name} quantity`}
                accessibilityValue={{ min: 0, now: quantity }}
              >
                <Pressable
                  onPress={() => updateQuantity(product.id, selectedVariant.id, quantity - 1)}
                  accessibilityRole="button"
                  accessibilityLabel={`Decrease ${product.name} quantity`}
                  style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                >
                  <ThemedText style={[styles.stepText, { color: theme.primary }]}>−</ThemedText>
                </Pressable>
                <ThemedText style={[styles.quantity, { color: theme.primary }]}>{quantity}</ThemedText>
                <Pressable
                  onPress={() => updateQuantity(product.id, selectedVariant.id, quantity + 1)}
                  accessibilityRole="button"
                  accessibilityLabel={`Increase ${product.name} quantity`}
                  style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                >
                  <ThemedText style={[styles.stepText, { color: theme.primary }]}>+</ThemedText>
                </Pressable>
              </View>
            ) : (
              <PrimaryButton label="ADD TO CART" onPress={() => addToCart(product, selectedVariant)} />
            )
          ) : (
            <PrimaryButton label={footerLabel} disabled onPress={() => {}} />
          )}
        </View>
      )}
      contentContainerStyle={styles.content}
      testID="product-detail-screen"
    >
      <View style={[styles.imageCard, { backgroundColor: theme.muted }]}>
        <ResilientRemoteImage uri={product.imageUrl} style={styles.mainImage} contentFit="cover" />
        <Pressable
          onPress={() => void toggleFavourite('PRODUCT', product.id)}
          style={({ pressed }) => [
            styles.favouriteButton,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={favourite ? 'Remove from favourites' : 'Add to favourites'}
          accessibilityState={{ selected: favourite }}
        >
          <AppIcon name="heart" color={favourite ? theme.danger : theme.textSecondary} size={22} />
        </Pressable>
      </View>

      <View style={styles.section}>
        <View style={styles.badgeRow}>
          {product.rating ? <StatusBadge label={product.rating} color={theme.warning} /> : null}
          {product.deliveryTime ? <StatusBadge label={`Delivery: ${product.deliveryTime}`} color={theme.success} /> : null}
          <StatusBadge
            label={variantOutOfStock ? 'Out of stock' : `In stock (${selectedVariant.stockCount})`}
            color={variantOutOfStock ? theme.danger : theme.primary}
          />
          {viewOnly ? <StatusBadge label="VIEW ONLY" color={theme.textSecondary} /> : null}
        </View>
        <ThemedText style={[styles.title, { color: theme.text }]}>{product.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Sold by {product.providerName}</ThemedText>
        <View style={styles.priceRow}>
          <ThemedText style={[styles.price, { color: theme.primary }]}>₹{currentPrice}</ThemedText>
          {currentOriginalPrice && currentOriginalPrice > currentPrice ? (
            <ThemedText style={[styles.strikethrough, { color: theme.textSecondary }]}>₹{currentOriginalPrice}</ThemedText>
          ) : null}
        </View>
      </View>

      {product.variants.length > 1 ? (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Select pack / size</ThemedText>
          <View style={styles.chipGrid}>
            {product.variants.map((variant) => (
              <FilterChip
                key={variant.id}
                label={`${variant.name} · ₹${variant.price}${variant.inStock && variant.stockCount > 0 ? '' : ' · Sold out'}`}
                selected={selectedVariant.id === variant.id}
                onPress={() => setSelectedVariant(variant)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {product.description ? (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Description</ThemedText>
          <ThemedText style={[styles.body, { color: theme.textSecondary }]}>{product.description}</ThemedText>
        </View>
      ) : null}

      {product.specifications && Object.keys(product.specifications).length > 0 ? (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Specifications</ThemedText>
          <View style={[styles.specCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            {Object.entries(product.specifications).map(([key, value]) => (
              <View key={key} style={styles.specRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.specKey}>{key}</ThemedText>
                <ThemedText type="small" style={styles.specValue}>{value}</ThemedText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {product.ingredients?.length ? (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Key ingredients</ThemedText>
          <ThemedText style={[styles.body, { color: theme.textSecondary }]}>{product.ingredients.join(', ')}</ThemedText>
        </View>
      ) : null}

      {product.suitability?.length ? (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Suitable for</ThemedText>
          <View style={styles.chipGrid}>
            {product.suitability.map((tag) => <StatusBadge key={tag} label={`✓ ${tag}`} color={theme.primary} />)}
          </View>
        </View>
      ) : null}

      <Pressable
        onPress={() => router.push(`/shop/${product.providerId}` as never)}
        accessibilityRole="button"
        accessibilityLabel={`Visit ${product.providerName}`}
        style={({ pressed }) => [
          styles.sellerCard,
          shadows.raised,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          pressed && styles.pressed,
        ]}
      >
        <AppIcon name="store" color={theme.primary} size={24} />
        <View style={styles.sellerCopy}>
          <ThemedText style={styles.sellerName}>{product.providerName}</ThemedText>
          {product.sellerInfo?.address ? (
            <ThemedText type="small" themeColor="textSecondary">{product.sellerInfo.address}</ThemedText>
          ) : null}
          <ThemedText type="small" style={{ color: product.pickupEnabled ? theme.success : theme.textSecondary, fontWeight: '700' }}>
            {product.pickupEnabled ? 'Store pickup available' : 'Pickup unavailable'}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: theme.primary }}>Visit store →</ThemedText>
      </Pressable>

      {product.deliveryEstimate || product.returnPolicy ? (
        <View style={[styles.policyBox, { backgroundColor: theme.muted }]}>
          {product.deliveryEstimate ? (
            <View style={styles.policyRow}>
              <AppIcon name="location" color={theme.primary} size={18} />
              <ThemedText type="small" style={styles.policyText}>
                <ThemedText type="smallBold">Delivery: </ThemedText>{product.deliveryEstimate}
              </ThemedText>
            </View>
          ) : null}
          {product.returnPolicy ? (
            <View style={styles.policyRow}>
              <AppIcon name="document" color={theme.textSecondary} size={18} />
              <ThemedText type="small" style={styles.policyText}>
                <ThemedText type="smallBold">Return policy: </ThemedText>{product.returnPolicy}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.x4, paddingBottom: spacing.x6 },
  imageCard: { width: '100%', height: 280, borderRadius: radii.card, overflow: 'hidden', position: 'relative' },
  mainImage: { width: '100%', height: '100%' },
  favouriteButton: { position: 'absolute', top: spacing.x3, right: spacing.x3, width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  section: { gap: spacing.x2 },
  badgeRow: { flexDirection: 'row', gap: spacing.x2, flexWrap: 'wrap' },
  title: { ...typography.headline, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  price: { ...typography.headline, fontSize: 25, fontWeight: '900' },
  strikethrough: { textDecorationLine: 'line-through', fontSize: 15 },
  sectionTitle: { ...typography.headline, fontSize: 16, fontWeight: '800' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  body: { ...typography.body, fontSize: 14, lineHeight: 21 },
  specCard: { borderRadius: radii.compact, borderWidth: StyleSheet.hairlineWidth, padding: spacing.x3, gap: spacing.x2 },
  specRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  specKey: { width: 120 },
  specValue: { flex: 1, fontWeight: '600' },
  sellerCard: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.x3, padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  sellerCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  sellerName: { fontWeight: '800', fontSize: 14 },
  policyBox: { padding: spacing.x4, borderRadius: radii.compact, gap: spacing.x3 },
  policyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  policyText: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.x4, paddingTop: spacing.x3, paddingBottom: spacing.x4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  footerPriceBlock: { minWidth: 92 },
  footerPrice: { ...typography.headline, fontSize: 20, fontWeight: '900' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact, minHeight: touchTarget },
  stepButton: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontWeight: '900', fontSize: 18 },
  quantity: { minWidth: 28, textAlign: 'center', fontWeight: '900' },
  pressed: { opacity: 0.78 },
});
