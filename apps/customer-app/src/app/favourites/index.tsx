import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, SectionHeader, StateView } from '@/components/foundation/primitives';
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
import { ApiError } from '@/services/api-client';
import type { CommerceProduct } from '@/services/catalog-data';
import type { PublicOutletSummary } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';
import {
  fetchServiceableCommerceProduct,
  fetchServiceableProductStore,
} from '@/services/paginated-catalog';

type FavouriteTab = 'ALL' | 'PRODUCTS' | 'SHOPS';
type ContentState = 'loading' | 'ready' | 'offline' | 'error';

interface UnavailableFavourite {
  targetType: 'PRODUCT' | 'SHOP';
  targetId: string;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export default function FavouritesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { selectedPincode } = useLocation();
  const {
    favourites,
    loading,
    error: favouritesError,
    retry: retryFavourites,
    toggleFavourite,
  } = useFavourites();
  const { addToCart, items, updateQuantity } = useCart();
  const [activeTab, setActiveTab] = useState<FavouriteTab>('ALL');
  const [favouriteProducts, setFavouriteProducts] = useState<CommerceProduct[]>([]);
  const [favouriteShops, setFavouriteShops] = useState<PublicOutletSummary[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableFavourite[]>([]);
  const [contentState, setContentState] = useState<ContentState>('loading');
  const [contentError, setContentError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const loadFavouriteEntities = useCallback(async () => {
    if (loading) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const isCurrent = () => requestGeneration.current === generation;

    const productIds = favourites
      .filter((favourite) => favourite.targetType === 'PRODUCT')
      .map((favourite) => favourite.targetId);
    const shopIds = favourites
      .filter((favourite) => favourite.targetType === 'SHOP')
      .map((favourite) => favourite.targetId);

    setFavouriteProducts([]);
    setFavouriteShops([]);
    setUnavailable([]);
    setContentError(null);

    if (favouritesError) {
      setContentState(isOfflineError(new Error(favouritesError)) ? 'offline' : 'error');
      setContentError(favouritesError);
      return;
    }

    if (productIds.length === 0 && shopIds.length === 0) {
      setContentState('ready');
      return;
    }

    if (!/^[1-9][0-9]{5}$/.test(selectedPincode)) {
      setContentState('error');
      setContentError('Select a valid live six-digit service PIN to resolve saved items.');
      return;
    }

    setContentState('loading');
    const [productResults, shopResults] = await Promise.all([
      Promise.allSettled(productIds.map((productId) => fetchServiceableCommerceProduct(productId, selectedPincode))),
      Promise.allSettled(shopIds.map((shopId) => fetchServiceableProductStore(shopId, selectedPincode))),
    ]);
    if (!isCurrent()) return;

    const products: CommerceProduct[] = [];
    const shops: PublicOutletSummary[] = [];
    const unavailableItems: UnavailableFavourite[] = [];
    const operationalFailures: unknown[] = [];

    productResults.forEach((result, index) => {
      const targetId = productIds[index];
      if (result.status === 'fulfilled') {
        const product = result.value;
        if (product.kind === 'PRODUCT' && product.commerceMode === 'COMMERCE') {
          products.push(product);
        } else {
          unavailableItems.push({ targetType: 'PRODUCT', targetId });
        }
      } else if (isNotFound(result.reason)) {
        unavailableItems.push({ targetType: 'PRODUCT', targetId });
      } else {
        operationalFailures.push(result.reason);
      }
    });

    shopResults.forEach((result, index) => {
      const targetId = shopIds[index];
      if (result.status === 'fulfilled') {
        shops.push(result.value);
      } else if (isNotFound(result.reason)) {
        unavailableItems.push({ targetType: 'SHOP', targetId });
      } else {
        operationalFailures.push(result.reason);
      }
    });

    if (!isCurrent()) return;
    setFavouriteProducts(products);
    setFavouriteShops(shops);
    setUnavailable(unavailableItems);

    if (operationalFailures.length > 0) {
      const failure = operationalFailures[0];
      setContentError(failure instanceof Error ? failure.message : 'Saved items could not be loaded.');
      setContentState(operationalFailures.some(isOfflineError) ? 'offline' : 'error');
      return;
    }
    setContentState('ready');
  }, [favourites, favouritesError, loading, selectedPincode]);

  useEffect(() => {
    void loadFavouriteEntities();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadFavouriteEntities]);

  const productSavedCount = favourites.filter((item) => item.targetType === 'PRODUCT').length;
  const shopSavedCount = favourites.filter((item) => item.targetType === 'SHOP').length;
  const savedTargetCount = favourites.length;
  const showProducts = activeTab === 'ALL' || activeTab === 'PRODUCTS';
  const showShops = activeTab === 'ALL' || activeTab === 'SHOPS';
  const visibleUnavailable = unavailable.filter((item) => (
    activeTab === 'ALL'
    || (activeTab === 'PRODUCTS' && item.targetType === 'PRODUCT')
    || (activeTab === 'SHOPS' && item.targetType === 'SHOP')
  ));
  const selectedCount = activeTab === 'PRODUCTS'
    ? productSavedCount
    : activeTab === 'SHOPS'
      ? shopSavedCount
      : savedTargetCount;
  const cardWidth = width >= 780 ? '48.8%' : '100%';

  const retry = useCallback(async () => {
    if (favouritesError) {
      await retryFavourites();
      return;
    }
    await loadFavouriteEntities();
  }, [favouritesError, loadFavouriteEntities, retryFavourites]);

  const removeUnavailable = useCallback(async (item: UnavailableFavourite) => {
    await toggleFavourite(item.targetType, item.targetId);
  }, [toggleFavourite]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="My favourites"
        subtitle={`${savedTargetCount} saved item${savedTargetCount === 1 ? '' : 's'} · PIN ${selectedPincode || 'not selected'}`}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        <FilterChip label={`All (${savedTargetCount})`} selected={activeTab === 'ALL'} onPress={() => setActiveTab('ALL')} />
        <FilterChip
          label={`Products (${productSavedCount})`}
          selected={activeTab === 'PRODUCTS'}
          onPress={() => setActiveTab('PRODUCTS')}
        />
        <FilterChip
          label={`Shops (${shopSavedCount})`}
          selected={activeTab === 'SHOPS'}
          onPress={() => setActiveTab('SHOPS')}
        />
      </ScrollView>

      {loading || contentState === 'loading' ? (
        <StateView kind="loading" title="Loading favourites" message="Checking current availability for the selected service PIN." />
      ) : contentState === 'offline' || contentState === 'error' ? (
        <StateView
          kind={contentState}
          title={contentState === 'offline' ? 'You are offline' : 'Favourites unavailable'}
          message={contentError ?? 'Could not load your saved items.'}
          actionLabel="Retry"
          onAction={() => void retry()}
        />
      ) : selectedCount === 0 ? (
        <StateView
          kind="empty"
          title={savedTargetCount === 0 ? 'No favourites saved yet' : `No saved ${activeTab.toLowerCase()}`}
          message={savedTargetCount === 0
            ? 'Tap the heart on a product or shop to keep it available here.'
            : 'Choose another favourites category.'}
          actionLabel={savedTargetCount === 0 ? 'Explore pet supplies' : 'Show all favourites'}
          onAction={() => {
            if (savedTargetCount === 0) router.push('/commerce' as never);
            else setActiveTab('ALL');
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {visibleUnavailable.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Saved but unavailable here" />
              <View style={styles.grid}>
                {visibleUnavailable.map((item) => (
                  <View
                    key={`${item.targetType}:${item.targetId}`}
                    style={[
                      styles.unavailableCard,
                      shadows.card,
                      { width: cardWidth, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                    ]}
                    accessibilityLabel={`Saved ${item.targetType.toLowerCase()} is unavailable for PIN ${selectedPincode}`}
                  >
                    <View style={styles.unavailableCopy}>
                      <AppIcon name={item.targetType === 'SHOP' ? 'store' : 'warning'} color={theme.textSecondary} size={24} />
                      <View style={styles.flex}>
                        <ThemedText style={styles.cardTitle}>
                          {item.targetType === 'SHOP' ? 'Saved shop unavailable' : 'Saved product unavailable'}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          It may be inactive, deleted, no longer commerce-enabled, or not serviceable for PIN {selectedPincode}. It remains saved until you remove it.
                        </ThemedText>
                      </View>
                    </View>
                    <PrimaryButton
                      label="Remove from favourites"
                      variant="secondary"
                      onPress={() => void removeUnavailable(item)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {showShops && favouriteShops.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Saved shops" />
              <View style={styles.grid}>
                {favouriteShops.map((shop) => (
                  <View
                    key={shop.id}
                    style={[
                      styles.shopCard,
                      shadows.card,
                      { width: cardWidth, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                    ]}
                  >
                    <Pressable
                      onPress={() => router.push(`/shop/${encodeURIComponent(shop.id)}` as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${shop.name} details`}
                      style={({ pressed }) => [styles.shopSummary, pressed && styles.pressed]}
                    >
                      <ResilientRemoteImage
                        uri={undefined}
                        style={styles.shopImage}
                        accessibilityLabel={shop.name}
                      />
                      <View style={styles.shopBody}>
                        <View style={styles.flex}>
                          <ThemedText style={styles.cardTitle} numberOfLines={2}>{shop.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">Serves PIN {selectedPincode}</ThemedText>
                        </View>
                        <StatusBadge
                          label={shop.pickupEnabled ? 'Pickup available' : 'Pickup unavailable'}
                          color={shop.pickupEnabled ? theme.success : theme.textSecondary}
                        />
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => void toggleFavourite('SHOP', shop.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${shop.name} from favourites`}
                      accessibilityState={{ selected: true }}
                      style={({ pressed }) => [styles.heartButton, styles.shopHeart, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
                    >
                      <AppIcon name="heart" color={theme.danger} size={21} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {showProducts && favouriteProducts.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Saved products" />
              <View style={styles.grid}>
                {favouriteProducts.map((product) => {
                  const cartItem = items.find((item) => item.product.id === product.id);
                  const quantity = cartItem?.quantity ?? 0;
                  const variant = product.variants[0];

                  return (
                    <View
                      key={product.id}
                      style={[
                        styles.productCard,
                        shadows.card,
                        { width: cardWidth, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                      ]}
                    >
                      <View style={[styles.productImageWrap, { backgroundColor: theme.muted }]}>
                        <Pressable
                          onPress={() => router.push(`/commerce/product-detail?id=${encodeURIComponent(product.id)}` as never)}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${product.name} details`}
                          style={({ pressed }) => [styles.productImageLink, pressed && styles.pressed]}
                        >
                          <ResilientRemoteImage
                            uri={product.imageUrl}
                            style={styles.productImage}
                            accessibilityLabel={product.name}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => void toggleFavourite('PRODUCT', product.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${product.name} from favourites`}
                          accessibilityState={{ selected: true }}
                          style={({ pressed }) => [styles.heartButton, styles.productHeart, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
                        >
                          <AppIcon name="heart" color={theme.danger} size={21} />
                        </Pressable>
                      </View>

                      <View style={styles.productBody}>
                        <Pressable
                          onPress={() => router.push(`/commerce/product-detail?id=${encodeURIComponent(product.id)}` as never)}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${product.name} details`}
                          style={({ pressed }) => [styles.productDetailsLink, pressed && styles.pressed]}
                        >
                          {product.brand ? <ThemedText type="small" themeColor="textSecondary">{product.brand}</ThemedText> : null}
                          <ThemedText style={styles.cardTitle} numberOfLines={2}>{product.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                            {product.providerName}
                          </ThemedText>
                        </Pressable>

                        <View style={styles.productFooter}>
                          <View style={styles.flex}>
                            <ThemedText style={[styles.price, { color: theme.primary }]}>₹{product.price}</ThemedText>
                            <ThemedText type="small" style={{ color: product.inStock ? theme.success : theme.danger, fontWeight: '700' }}>
                              {product.inStock ? 'In stock' : 'Out of stock'}
                            </ThemedText>
                          </View>

                          {quantity > 0 ? (
                            <View style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
                              <Pressable
                                onPress={(event) => {
                                  event.stopPropagation();
                                  updateQuantity(product.id, variant?.id, quantity - 1);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={`Decrease ${product.name} quantity`}
                                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                              >
                                <ThemedText style={{ color: theme.primary, fontWeight: '900' }}>−</ThemedText>
                              </Pressable>
                              <ThemedText style={{ color: theme.primary, fontWeight: '900', minWidth: 22, textAlign: 'center' }}>{quantity}</ThemedText>
                              <Pressable
                                onPress={(event) => {
                                  event.stopPropagation();
                                  updateQuantity(product.id, variant?.id, quantity + 1);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={`Increase ${product.name} quantity`}
                                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                              >
                                <ThemedText style={{ color: theme.primary, fontWeight: '900' }}>+</ThemedText>
                              </Pressable>
                            </View>
                          ) : (
                            <PrimaryButton
                              label="Add"
                              disabled={!variant?.inStock}
                              onPress={() => {
                                if (variant) addToCart(product, variant);
                              }}
                              style={styles.addButton}
                            />
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.x4, paddingTop: spacing.x2 },
  flex: { flex: 1 },
  tabRow: { gap: spacing.x2, paddingRight: spacing.x4, paddingBottom: spacing.x3 },
  content: { gap: spacing.x6, paddingBottom: spacing.x8 },
  section: { gap: spacing.x3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x3 },
  unavailableCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  unavailableCopy: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  shopCard: { position: 'relative', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card },
  shopSummary: { flex: 1 },
  shopImage: { width: '100%', height: 150 },
  shopBody: { padding: spacing.x3, gap: spacing.x2 },
  cardTitle: { ...typography.label, fontSize: 15, lineHeight: 21 },
  heartButton: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  shopHeart: { position: 'absolute', top: 150 + spacing.x2, right: spacing.x2 },
  productCard: { minHeight: 154, flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, overflow: 'hidden' },
  productImageWrap: { width: 124, position: 'relative' },
  productImageLink: { flex: 1 },
  productImage: { width: '100%', height: '100%' },
  productHeart: { position: 'absolute', top: spacing.x1, right: spacing.x1 },
  productBody: { flex: 1, padding: spacing.x3, gap: spacing.x1 },
  productDetailsLink: { gap: spacing.x1 },
  productFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.x2, marginTop: 'auto' },
  price: { ...typography.title, fontSize: 18, lineHeight: 24 },
  stepper: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact },
  stepButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  addButton: { minWidth: 82, minHeight: touchTarget, paddingHorizontal: spacing.x3 },
  pressed: { opacity: 0.82 },
});
