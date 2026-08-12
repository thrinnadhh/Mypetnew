import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { useFavourites } from '@/context/FavouritesContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CommerceProduct, ProductVariant } from '@/services/catalog-data';
import { fetchCommerceProduct } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { addToCart, items, updateQuantity } = useCart();
  const { isFavourite, toggleFavourite } = useFavourites();
  const [product, setProduct] = useState<CommerceProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    if (!id) {
      setState('error');
      return;
    }

    setState('loading');
    try {
      const nextProduct = await fetchCommerceProduct(id);
      setProduct(nextProduct);
      setSelectedVariant(nextProduct.variants[0] ?? null);
      setState('ready');
    } catch (error) {
      setProduct(null);
      setSelectedVariant(null);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Product" subtitle="Loading live price and stock" />
        <StateView kind="loading" title="Loading product" />
      </View>
    );
  }

  if (state === 'offline' || state === 'error' || !product || !selectedVariant) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Product" subtitle="Live catalog" />
        <StateView
          kind={state === 'offline' ? 'offline' : 'error'}
          title={state === 'offline' ? 'You are offline' : 'Product unavailable'}
          message={state === 'offline' ? 'Reconnect to verify the latest price and stock.' : 'This product is no longer available.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </View>
    );
  }

  const isFav = isFavourite('PRODUCT', product.id);
  const cartItem = items.find(
    (item) => item.product.id === product.id && item.selectedVariant?.id === selectedVariant.id,
  );
  const qtyInCart = cartItem?.quantity ?? 0;
  const currentPrice = selectedVariant.price;
  const currentOriginalPrice = selectedVariant.originalPrice ?? product.originalPrice;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader title={product.brand} subtitle={product.name} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.imageCard}>
          <Image source={{ uri: product.imageUrl }} style={styles.mainImage} resizeMode="cover" />
          <Pressable
            onPress={() => void toggleFavourite('PRODUCT', product.id)}
            style={[styles.favBadge, { backgroundColor: theme.background }]}
            accessibilityRole="button"
            accessibilityLabel={isFav ? 'Remove from favourites' : 'Add to favourites'}
            accessibilityState={{ selected: isFav }}
          >
            <AppIcon name="heart" color={isFav ? theme.danger : theme.textSecondary} size={22} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <View style={styles.badgeRow}>
            <StatusBadge label={product.rating} color={theme.warning} />
            <StatusBadge label={`Delivery: ${product.deliveryTime}`} color={theme.success} />
            <StatusBadge
              label={selectedVariant.inStock ? `In stock (${selectedVariant.stockCount})` : 'Out of stock'}
              color={selectedVariant.inStock ? theme.primary : theme.danger}
            />
          </View>

          <ThemedText style={[styles.title, { color: theme.text }]}>{product.name}</ThemedText>
          <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>Sold by {product.providerName}</ThemedText>

          <View style={styles.priceRow}>
            <ThemedText style={[styles.priceText, { color: theme.primary }]}>₹{currentPrice}</ThemedText>
            {currentOriginalPrice ? <ThemedText style={styles.strikethrough}>₹{currentOriginalPrice}</ThemedText> : null}
          </View>
        </View>

        {product.variants.length > 1 ? (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Select Pack / Size</ThemedText>
            <View style={styles.chipGrid}>
              {product.variants.map((variant) => (
                <FilterChip
                  key={variant.id}
                  label={`${variant.name} - ₹${variant.price}`}
                  selected={selectedVariant.id === variant.id}
                  onPress={() => setSelectedVariant(variant)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Description</ThemedText>
          <ThemedText style={[styles.bodyText, { color: theme.textSecondary }]}>{product.description}</ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Specifications</ThemedText>
          <View style={[styles.specCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            {Object.entries(product.specifications).map(([key, value]) => (
              <View key={key} style={styles.specRow}>
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary, width: 120 }}>{key}</ThemedText>
                <ThemedText style={{ fontSize: 13, color: theme.text, fontWeight: '600', flex: 1 }}>{value}</ThemedText>
              </View>
            ))}
          </View>
        </View>

        {product.ingredients && product.ingredients.length > 0 ? (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Key Ingredients</ThemedText>
            <ThemedText style={[styles.bodyText, { color: theme.textSecondary }]}>
              {product.ingredients.join(', ')}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Suitable For</ThemedText>
          <View style={styles.chipGrid}>
            {product.suitability.map((tag) => (
              <StatusBadge key={tag} label={`✓ ${tag}`} color={theme.primary} />
            ))}
          </View>
        </View>

        <Pressable
          onPress={() => router.push(`/shop/${product.providerId}` as never)}
          style={[styles.sellerCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        >
          <AppIcon name="store" color={theme.primary} size={24} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '700', fontSize: 14, color: theme.text }}>{product.providerName}</ThemedText>
            <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>{product.sellerInfo.address}</ThemedText>
          </View>
          <ThemedText style={{ color: theme.primary, fontWeight: '700', fontSize: 13 }}>Visit Store →</ThemedText>
        </Pressable>

        <View style={[styles.policyBox, { backgroundColor: theme.muted }]}>
          <View style={styles.policyRow}>
            <AppIcon name="location" color={theme.primary} size={18} />
            <ThemedText style={{ fontSize: 13, color: theme.text, flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }}>Delivery: </ThemedText>
              {product.deliveryEstimate}
            </ThemedText>
          </View>
          <View style={styles.policyRow}>
            <AppIcon name="warning" color={theme.textSecondary} size={18} />
            <ThemedText style={{ fontSize: 13, color: theme.text, flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }}>Return Policy: </ThemedText>
              {product.returnPolicy}
            </ThemedText>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.stickyFooter, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View>
          <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>Total Price</ThemedText>
          <ThemedText style={[styles.footerPrice, { color: theme.primary }]}>₹{currentPrice * (qtyInCart || 1)}</ThemedText>
        </View>

        {qtyInCart > 0 ? (
          <View style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
            <Pressable onPress={() => updateQuantity(product.id, selectedVariant.id, qtyInCart - 1)} style={styles.stepBtn}>
              <ThemedText style={{ color: theme.primary, fontWeight: '800', fontSize: 16 }}>-</ThemedText>
            </Pressable>
            <ThemedText style={{ color: theme.primary, fontWeight: '800', fontSize: 15, paddingHorizontal: 12 }}>{qtyInCart}</ThemedText>
            <Pressable onPress={() => updateQuantity(product.id, selectedVariant.id, qtyInCart + 1)} style={styles.stepBtn}>
              <ThemedText style={{ color: theme.primary, fontWeight: '800', fontSize: 16 }}>+</ThemedText>
            </Pressable>
          </View>
        ) : (
          <PrimaryButton
            label="ADD TO CART"
            disabled={!selectedVariant.inStock}
            onPress={() => addToCart(product, selectedVariant)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.x3 },
  scrollContent: { paddingBottom: 100, gap: spacing.x4 },
  imageCard: { width: '100%', height: 240, borderRadius: radii.card, overflow: 'hidden', position: 'relative' },
  mainImage: { width: '100%', height: '100%' },
  favBadge: { position: 'absolute', top: 12, right: 12, borderRadius: 20, padding: 8, elevation: 3 },
  section: { gap: spacing.x2 },
  badgeRow: { flexDirection: 'row', gap: spacing.x2, flexWrap: 'wrap' },
  title: { ...typography.headline, fontSize: 20, fontWeight: '800' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, marginTop: 4 },
  priceText: { ...typography.headline, fontSize: 24, fontWeight: '900' },
  strikethrough: { textDecorationLine: 'line-through', fontSize: 16, color: '#888888' },
  sectionTitle: { ...typography.headline, fontSize: 15, fontWeight: '700' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  bodyText: { ...typography.body, fontSize: 14, lineHeight: 20 },
  specCard: { borderRadius: radii.compact, borderWidth: 1, padding: spacing.x3, gap: spacing.x2 },
  specRow: { flexDirection: 'row', alignItems: 'center' },
  sellerCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, padding: spacing.x4, borderRadius: radii.card, borderWidth: 1 },
  policyBox: { padding: spacing.x4, borderRadius: radii.compact, gap: spacing.x3 },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  stickyFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 1, padding: spacing.x4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerPrice: { ...typography.headline, fontSize: 20, fontWeight: '900' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: 8, height: 44 },
  stepBtn: { paddingHorizontal: 12, paddingVertical: 6 },
});
