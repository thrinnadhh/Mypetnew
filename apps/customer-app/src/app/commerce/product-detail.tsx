import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiErrorKind } from '@/contracts/api-error';
import { useCart } from '@/context/CartContext';
import { useFavourites } from '@/context/FavouritesContext';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CommerceProduct, ProductVariant } from '@/services/catalog-data';
import { isCommerceEligible } from '@/services/commerce-eligibility';
import { isOfflineError } from '@/services/customer-profile';
import { fetchServiceableCommerceProduct } from '@/services/paginated-catalog';
import { appConfig } from '@/utils/app-config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LoadState = 'loading' | 'ready' | 'offline' | 'error' | 'not-found' | 'unavailable';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function money(value: number): string {
  return Number.isInteger(value) ? `₹${value}` : `₹${value.toFixed(2)}`;
}

function knownStock(product: CommerceProduct, variant: ProductVariant): number {
  const productStock = product.availableQuantity ?? product.stockCount;
  return Math.max(0, Math.min(productStock, variant.stockCount));
}

export default function ProductDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = single(params.id)?.trim();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { selectedPincode } = useLocation();
  const { addToCart, items, updateQuantity } = useCart();
  const { isFavourite, toggleFavourite } = useFavourites();
  const [product, setProduct] = useState<CommerceProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [favouritePending, setFavouritePending] = useState(false);
  const requestGeneration = useRef(0);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/products' as never);
  }, [router]);

  const returnToProducts = useCallback(() => {
    router.replace('/products' as never);
  }, [router]);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;

    if (!id || (!appConfig.allowDemoMode && !UUID_PATTERN.test(id))) {
      setProduct(null);
      setSelectedVariant(null);
      setGalleryIndex(0);
      setState('not-found');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(selectedPincode)) {
      setProduct(null);
      setSelectedVariant(null);
      setGalleryIndex(0);
      setState('error');
      return;
    }

    setState('loading');
    try {
      const nextProduct = await fetchServiceableCommerceProduct(id, selectedPincode);
      if (requestGeneration.current !== generation) return;

      const nextVariant =
        nextProduct.variants.find((variant) => variant.inStock && variant.stockCount > 0)
        ?? nextProduct.variants[0]
        ?? null;
      setProduct(nextProduct);
      setSelectedVariant(nextVariant);
      setGalleryIndex(0);
      setState(nextVariant ? 'ready' : 'unavailable');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setProduct(null);
      setSelectedVariant(null);
      setGalleryIndex(0);
      if (isOfflineError(error)) {
        setState('offline');
      } else if (apiErrorKind(error) === 'not-found') {
        setState('unavailable');
      } else {
        setState('error');
      }
    }
  }, [id, selectedPincode]);

  React.useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  const galleryImages = useMemo(() => {
    if (!product) return [];
    const unique = new Set<string>();
    for (const value of [product.imageUrl, ...product.galleryImages]) {
      const normalized = value?.trim();
      if (normalized) unique.add(normalized);
    }
    return [...unique];
  }, [product]);

  if (state === 'loading') {
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title="Product" subtitle={`Loading live price and stock for PIN ${selectedPincode}`} onBack={goBack} />}
        testID="product-detail-screen"
      >
        <StateView kind="loading" title="Loading product" message="Checking current price, images, availability and store stock." />
      </ScreenShell>
    );
  }

  if (state !== 'ready' || !product || !selectedVariant) {
    const invalidLink = state === 'not-found';
    const unavailable = state === 'unavailable';
    const offline = state === 'offline';
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title="Product" subtitle={`Service PIN ${selectedPincode}`} onBack={goBack} />}
        contentContainerStyle={styles.stateContent}
        testID="product-detail-screen"
      >
        <StateView
          kind={offline ? 'offline' : 'error'}
          title={
            invalidLink
              ? 'Product link is invalid'
              : unavailable
                ? 'Product unavailable'
                : offline
                  ? 'You are offline'
                  : 'Product could not be loaded'
          }
          message={
            invalidLink
              ? 'This product link is missing or invalid.'
              : unavailable
                ? `This product is no longer public or is not available from an active store serving PIN ${selectedPincode}.`
                : offline
                  ? 'Reconnect to verify the latest price, stock and serviceability.'
                  : 'The live product could not be loaded. No demo product was substituted.'
          }
          actionLabel={invalidLink ? 'Return to products' : 'Retry'}
          onAction={invalidLink ? returnToProducts : () => { void load(); }}
        />
        {!invalidLink ? (
          <PrimaryButton label="Return to products" variant="secondary" onPress={returnToProducts} />
        ) : null}
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
  const maxStock = knownStock(product, selectedVariant);
  const atKnownMax = quantity >= maxStock;
  const canPurchase = isCommerceEligible(product) && !variantOutOfStock && !productOutOfStock && maxStock > 0;
  const selectedImage = galleryImages[galleryIndex] ?? product.imageUrl;

  const footerLabel = viewOnly
    ? 'View only — online purchase is unavailable'
    : pickupDisabled
      ? 'Pickup unavailable'
      : variantOutOfStock || productOutOfStock
        ? 'Out of stock'
        : 'Unavailable';

  const handleFavourite = async () => {
    if (favouritePending) return;
    setFavouritePending(true);
    try {
      await toggleFavourite('PRODUCT', product.id);
    } finally {
      setFavouritePending(false);
    }
  };

  return (
    <ScreenShell
      header={<ScreenHeader title={product.brand || 'Product'} subtitle={product.name} onBack={goBack} />}
      footer={(
        <View
          style={[
            styles.footer,
            shadows.raised,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border, paddingBottom: Math.max(spacing.x3, insets.bottom + spacing.x2) },
          ]}
        >
          <View style={styles.footerPriceBlock}>
            <ThemedText type="small" themeColor="textSecondary">
              {quantity > 0 ? 'Current item total' : 'Current price'}
            </ThemedText>
            <ThemedText style={[styles.footerPrice, { color: theme.primary }]}>
              {money(currentPrice * Math.max(quantity, 1))}
            </ThemedText>
          </View>
          {canPurchase ? (
            quantity > 0 ? (
              <View style={styles.footerActions}>
                <View
                  style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}
                  accessibilityRole="adjustable"
                  accessibilityLabel={`${product.name} quantity`}
                  accessibilityValue={{ min: 1, max: maxStock, now: quantity }}
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
                    disabled={atKnownMax}
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${product.name} quantity`}
                    accessibilityState={{ disabled: atKnownMax }}
                    style={({ pressed }) => [styles.stepButton, atKnownMax && styles.disabled, pressed && !atKnownMax && styles.pressed]}
                  >
                    <ThemedText style={[styles.stepText, { color: theme.primary }]}>+</ThemedText>
                  </Pressable>
                </View>
                <PrimaryButton label="View Cart" variant="secondary" onPress={() => router.push('/cart' as never)} style={styles.cartButton} />
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
        <ResilientRemoteImage
          uri={selectedImage}
          style={styles.mainImage}
          contentFit="contain"
          accessibilityLabel={`${product.name} product image ${galleryImages.length > 1 ? `${galleryIndex + 1} of ${galleryImages.length}` : ''}`.trim()}
        />
        <Pressable
          onPress={() => { void handleFavourite(); }}
          disabled={favouritePending}
          style={({ pressed }) => [
            styles.favouriteButton,
            { backgroundColor: theme.backgroundElement },
            favouritePending && styles.disabled,
            pressed && !favouritePending && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={favourite ? 'Remove from favourites' : 'Add to favourites'}
          accessibilityState={{ selected: favourite, disabled: favouritePending, busy: favouritePending }}
        >
          <AppIcon name="heart" color={favourite ? theme.danger : theme.textSecondary} size={22} />
        </Pressable>
      </View>

      {galleryImages.length > 1 ? (
        <View style={styles.gallerySection}>
          <ThemedText type="smallBold">Product images</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
            {galleryImages.map((image, index) => {
              const selected = index === galleryIndex;
              return (
                <Pressable
                  key={`${image}-${index}`}
                  onPress={() => setGalleryIndex(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show product image ${index + 1} of ${galleryImages.length}`}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.thumbnailButton,
                    { borderColor: selected ? theme.primary : theme.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <ResilientRemoteImage uri={image} style={styles.thumbnailImage} contentFit="cover" />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.badgeRow}>
          {product.rating ? <StatusBadge label={product.rating} color={theme.warning} /> : null}
          {product.deliveryTime ? <StatusBadge label={`Delivery: ${product.deliveryTime}`} color={theme.success} /> : null}
          <StatusBadge
            label={variantOutOfStock ? 'Out of stock' : `In stock (${maxStock})`}
            color={variantOutOfStock ? theme.danger : theme.primary}
          />
          {viewOnly ? <StatusBadge label="VIEW ONLY" color={theme.textSecondary} /> : null}
        </View>
        <ThemedText style={[styles.title, { color: theme.text }]}>{product.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Sold by {product.providerName}</ThemedText>
        <View style={styles.priceRow}>
          <ThemedText style={[styles.price, { color: theme.primary }]}>{money(currentPrice)}</ThemedText>
          {currentOriginalPrice && currentOriginalPrice > currentPrice ? (
            <ThemedText style={[styles.strikethrough, { color: theme.textSecondary }]}>{money(currentOriginalPrice)}</ThemedText>
          ) : null}
        </View>
      </View>

      {product.variants.length > 1 ? (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Select pack / size</ThemedText>
          <View style={styles.chipGrid}>
            {product.variants.map((variant) => {
              const unavailable = !variant.inStock || variant.stockCount <= 0;
              return (
                <FilterChip
                  key={variant.id}
                  label={`${variant.name} · ${money(variant.price)}${unavailable ? ' · Sold out' : ''}`}
                  selected={selectedVariant.id === variant.id}
                  disabled={unavailable}
                  onPress={() => setSelectedVariant(variant)}
                />
              );
            })}
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
        onPress={() => router.push(`/shop/${encodeURIComponent(product.providerId)}` as never)}
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
  stateContent: { paddingHorizontal: spacing.x4, paddingBottom: spacing.x4, gap: spacing.x3 },
  content: { gap: spacing.x4, paddingBottom: spacing.x6 },
  imageCard: { width: '100%', aspectRatio: 1.18, maxHeight: 360, minHeight: 240, borderRadius: radii.card, overflow: 'hidden', position: 'relative' },
  mainImage: { width: '100%', height: '100%' },
  favouriteButton: { position: 'absolute', top: spacing.x3, right: spacing.x3, width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  gallerySection: { gap: spacing.x2 },
  thumbnailRow: { gap: spacing.x2, paddingRight: spacing.x2 },
  thumbnailButton: { width: 64, height: 64, minWidth: touchTarget, minHeight: touchTarget, borderRadius: radii.compact, borderWidth: 2, overflow: 'hidden' },
  thumbnailImage: { width: '100%', height: '100%' },
  section: { gap: spacing.x2 },
  badgeRow: { flexDirection: 'row', gap: spacing.x2, flexWrap: 'wrap' },
  title: { ...typography.headline, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, flexWrap: 'wrap' },
  price: { ...typography.headline, fontSize: 25, fontWeight: '900' },
  strikethrough: { textDecorationLine: 'line-through', fontSize: 15 },
  sectionTitle: { ...typography.headline, fontSize: 16, fontWeight: '800' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  body: { ...typography.body, fontSize: 14, lineHeight: 21 },
  specCard: { borderRadius: radii.compact, borderWidth: StyleSheet.hairlineWidth, padding: spacing.x3, gap: spacing.x2 },
  specRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  specKey: { width: 120, flexShrink: 0 },
  specValue: { flex: 1 },
  sellerCard: { minHeight: touchTarget, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.x3, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  sellerCopy: { flex: 1, minWidth: 0, gap: 2 },
  sellerName: { fontSize: 14, fontWeight: '800' },
  policyBox: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x2 },
  policyRow: { flexDirection: 'row', gap: spacing.x2, alignItems: 'flex-start' },
  policyText: { flex: 1, lineHeight: 18 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.x3, gap: spacing.x3, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  footerPriceBlock: { minWidth: 112, flexShrink: 0 },
  footerPrice: { ...typography.headline, fontSize: 20, fontWeight: '900' },
  footerActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.x2, flexWrap: 'wrap' },
  cartButton: { minWidth: 112 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.pill, minHeight: touchTarget },
  stepButton: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, fontWeight: '800' },
  quantity: { minWidth: 28, textAlign: 'center', fontWeight: '800' },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
});
