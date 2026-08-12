import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, SectionHeader, StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { useFavourites } from '@/context/FavouritesContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CommerceProduct, ShopProfileData } from '@/services/catalog-data';
import { fetchCommerceProduct, fetchShopProfile } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

type FavouriteTab = 'ALL' | 'PRODUCTS' | 'SHOPS';
type ContentState = 'loading' | 'ready' | 'offline' | 'error';

export default function FavouritesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { favourites, loading, toggleFavourite } = useFavourites();
  const { addToCart, items, updateQuantity } = useCart();
  const [activeTab, setActiveTab] = useState<FavouriteTab>('ALL');
  const [favouriteProducts, setFavouriteProducts] = useState<CommerceProduct[]>([]);
  const [favouriteShops, setFavouriteShops] = useState<ShopProfileData[]>([]);
  const [contentState, setContentState] = useState<ContentState>('loading');
  const [contentError, setContentError] = useState<string | null>(null);

  const loadFavouriteEntities = useCallback(async () => {
    if (loading) return;
    const productIds = favourites
      .filter((favourite) => favourite.targetType === 'PRODUCT')
      .map((favourite) => favourite.targetId);
    const shopIds = favourites
      .filter((favourite) => favourite.targetType === 'SHOP')
      .map((favourite) => favourite.targetId);

    if (productIds.length === 0 && shopIds.length === 0) {
      setFavouriteProducts([]);
      setFavouriteShops([]);
      setContentState('ready');
      setContentError(null);
      return;
    }

    setContentState('loading');
    setContentError(null);
    try {
      const [productResults, shopResults] = await Promise.all([
        Promise.allSettled(productIds.map((productId) => fetchCommerceProduct(productId))),
        Promise.allSettled(shopIds.map((shopId) => fetchShopProfile(shopId))),
      ]);
      const products = productResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const shops = shopResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failures = [...productResults, ...shopResults].filter(
        (result) => result.status === 'rejected',
      );

      setFavouriteProducts(products);
      setFavouriteShops(shops);
      if (failures.length > 0 && products.length === 0 && shops.length === 0) {
        const reason = failures[0].status === 'rejected' ? failures[0].reason : null;
        throw reason instanceof Error ? reason : new Error('Saved items could not be loaded.');
      }
      setContentState('ready');
    } catch (error) {
      setFavouriteProducts([]);
      setFavouriteShops([]);
      setContentError(error instanceof Error ? error.message : 'Saved items could not be loaded.');
      setContentState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [favourites, loading]);

  useEffect(() => {
    void loadFavouriteEntities();
  }, [loadFavouriteEntities]);

  const totalCount = favouriteProducts.length + favouriteShops.length;
  const savedTargetCount = favourites.length;
  const showProducts = activeTab === 'ALL' || activeTab === 'PRODUCTS';
  const showShops = activeTab === 'ALL' || activeTab === 'SHOPS';
  const selectedCount = activeTab === 'PRODUCTS'
    ? favouriteProducts.length
    : activeTab === 'SHOPS'
      ? favouriteShops.length
      : totalCount;
  const cardWidth = width >= 780 ? '48.8%' : '100%';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="My favourites"
        subtitle={`${savedTargetCount} saved product${savedTargetCount === 1 ? '' : 's'} and shops`}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        <FilterChip label={`All (${totalCount})`} selected={activeTab === 'ALL'} onPress={() => setActiveTab('ALL')} />
        <FilterChip
          label={`Products (${favouriteProducts.length})`}
          selected={activeTab === 'PRODUCTS'}
          onPress={() => setActiveTab('PRODUCTS')}
        />
        <FilterChip
          label={`Shops (${favouriteShops.length})`}
          selected={activeTab === 'SHOPS'}
          onPress={() => setActiveTab('SHOPS')}
        />
      </ScrollView>

      {loading || contentState === 'loading' ? (
        <StateView kind="loading" title="Loading favourites" message="Checking current products, prices, stock, and stores." />
      ) : contentState === 'offline' || contentState === 'error' ? (
        <StateView
          kind={contentState}
          title={contentState === 'offline' ? 'You are offline' : 'Favourites unavailable'}
          message={contentError ?? 'Could not load your saved items.'}
          actionLabel="Retry"
          onAction={() => void loadFavouriteEntities()}
        />
      ) : selectedCount === 0 ? (
        <StateView
          kind="empty"
          title={savedTargetCount === 0 ? 'No favourites saved yet' : `No available ${activeTab.toLowerCase()}`}
          message={
            savedTargetCount === 0
              ? 'Tap the heart on a product or shop to keep it available here.'
              : 'A saved item may have been removed or deactivated. Choose another category or refresh.'
          }
          actionLabel={savedTargetCount === 0 ? 'Explore pet supplies' : 'Show all favourites'}
          onAction={() => {
            if (savedTargetCount === 0) router.push('/commerce' as never);
            else setActiveTab('ALL');
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {showShops && favouriteShops.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Saved shops" />
              <View style={styles.grid}>
                {favouriteShops.map((shop) => (
                  <Pressable
                    key={shop.id}
                    onPress={() => router.push(`/shop/${shop.id}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`${shop.name}. ${shop.tagline}. Rated ${shop.rating}.`}
                    style={({ pressed }) => [
                      styles.shopCard,
                      shadows.card,
                      { width: cardWidth, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Image source={{ uri: shop.heroImageUrl }} style={styles.shopImage} resizeMode="cover" />
                    <View style={styles.shopBody}>
                      <View style={styles.cardTopRow}>
                        <View style={styles.flex}>
                          <ThemedText style={styles.cardTitle} numberOfLines={1}>{shop.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{shop.tagline}</ThemedText>
                        </View>
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            void toggleFavourite('SHOP', shop.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${shop.name} from favourites`}
                          accessibilityState={{ selected: true }}
                          style={({ pressed }) => [styles.heartButton, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
                        >
                          <AppIcon name="heart" color={theme.danger} size={21} />
                        </Pressable>
                      </View>
                      <View style={styles.metaRow}>
                        <StatusBadge label={shop.rating} color={theme.warning} />
                        <ThemedText type="small" themeColor="textSecondary">{shop.deliveryEta}</ThemedText>
                      </View>
                      <View style={styles.addressRow}>
                        <AppIcon name="location" color={theme.textSecondary} size={16} />
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
                          {shop.address}
                        </ThemedText>
                      </View>
                    </View>
                  </Pressable>
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
                    <Pressable
                      key={product.id}
                      onPress={() => router.push(`/commerce/product-detail?id=${product.id}` as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`${product.name}. ${product.brand}. ₹${product.price}.`}
                      style={({ pressed }) => [
                        styles.productCard,
                        shadows.card,
                        { width: cardWidth, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={[styles.productImageWrap, { backgroundColor: theme.muted }]}>
                        <Image source={{ uri: product.imageUrl }} style={styles.productImage} resizeMode="cover" />
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            void toggleFavourite('PRODUCT', product.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${product.name} from favourites`}
                          accessibilityState={{ selected: true }}
                          style={({ pressed }) => [styles.heartButton, styles.productHeart, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
                        >
                          <AppIcon name="heart" color={theme.danger} size={21} />
                        </Pressable>
                      </View>

                      <View style={styles.productBody}>
                        <ThemedText type="small" themeColor="textSecondary">{product.brand}</ThemedText>
                        <ThemedText style={styles.cardTitle} numberOfLines={2}>{product.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {product.providerName} · {product.deliveryTime}
                        </ThemedText>

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
                    </Pressable>
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
  shopCard: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card },
  shopImage: { width: '100%', height: 150 },
  shopBody: { padding: spacing.x3, gap: spacing.x2 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x2 },
  cardTitle: { ...typography.label, fontSize: 15, lineHeight: 21 },
  heartButton: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  productCard: { minHeight: 154, flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, overflow: 'hidden' },
  productImageWrap: { width: 124, position: 'relative' },
  productImage: { width: '100%', height: '100%' },
  productHeart: { position: 'absolute', top: spacing.x1, right: spacing.x1 },
  productBody: { flex: 1, padding: spacing.x3, gap: spacing.x1 },
  productFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.x2, marginTop: 'auto' },
  price: { ...typography.title, fontSize: 18, lineHeight: 24 },
  stepper: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact },
  stepButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  addButton: { minWidth: 82, minHeight: touchTarget, paddingHorizontal: spacing.x3 },
  pressed: { opacity: 0.82 },
});
