import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip } from '@/components/foundation/primitives';
import { LoyaltyCard } from '@/components/loyalty-card';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { useFavourites } from '@/context/FavouritesContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { type CommerceProduct, type ShopProfileData } from '@/services/catalog-data';
import { isCommerceEligible } from '@/services/commerce-eligibility';
import { DEMO_MEDIA } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';

interface ProviderProfileTemplateProps {
  shop: ShopProfileData;
}

function fallbackForProduct(product: CommerceProduct): string | undefined {
  if (!appConfig.allowDemoMode) {
    return undefined;
  }
  switch (product.category) {
    case 'food': return DEMO_MEDIA.food;
    case 'treats': return DEMO_MEDIA.treats;
    case 'toys': return DEMO_MEDIA.toys;
    case 'travel': return DEMO_MEDIA.travel;
    case 'furniture': return DEMO_MEDIA.furniture;
    case 'grooming': return DEMO_MEDIA.grooming;
    case 'vaccinations': return DEMO_MEDIA.hospital;
    default: return DEMO_MEDIA.store;
  }
}

export function ProviderProfileTemplate({ shop }: ProviderProfileTemplateProps) {
  const router = useRouter();
  const theme = useTheme();
  const { addToCart, items, providerId, totalItemsCount, subtotalAmount, updateQuantity } = useCart();
  const { isFavourite, toggleFavourite } = useFavourites();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const isShopFav = isFavourite('SHOP', shop.id);

  const filteredProducts = selectedCategory
    ? shop.products.filter((product) => product.category.toLowerCase().includes(selectedCategory.toLowerCase()))
    : shop.products;

  const isCartFromThisShop = providerId === shop.id && totalItemsCount > 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader title={shop.name} subtitle="Product Store" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ResilientRemoteImage
            uri={shop.heroImageUrl}
            fallbackUri={appConfig.allowDemoMode ? DEMO_MEDIA.store : undefined}
            style={styles.heroImage}
          />

          <View style={styles.heroBody}>
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.shopName, { color: theme.text }]}>{shop.name}</ThemedText>
                {shop.tagline ? <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>{shop.tagline}</ThemedText> : null}
              </View>
              <Pressable
                onPress={() => void toggleFavourite('SHOP', shop.id)}
                style={[styles.favBtn, { backgroundColor: isShopFav ? theme.primarySoft : theme.muted }]}
                accessibilityLabel={isShopFav ? 'Remove store from favourites' : 'Add store to favourites'}
                accessibilityRole="button"
                accessibilityState={{ selected: isShopFav }}
              >
                <AppIcon name={isShopFav ? 'check' : 'heart'} color={isShopFav ? theme.primary : theme.textSecondary} size={20} />
              </Pressable>
            </View>

            <View style={styles.badgeRow}>
              {shop.rating ? <StatusBadge label={`${shop.rating} (${shop.reviewCount} reviews)`} color={theme.warning} /> : null}
              {shop.deliveryEta ? <StatusBadge label={shop.deliveryEta} color={theme.success} /> : null}
              {shop.pickupEnabled !== undefined ? (
                <StatusBadge
                  label={shop.pickupEnabled === true ? 'Store Pickup Available' : 'Pickup Unavailable'}
                  color={shop.pickupEnabled === true ? theme.success : theme.textSecondary}
                />
              ) : null}
              {shop.isVerified ? <StatusBadge label="Verified Partner" color={theme.primary} /> : null}
            </View>

            {shop.address ? (
              <View style={styles.infoRow}>
                <AppIcon name="location" color={theme.primary} size={16} />
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary, flex: 1 }}>{shop.address}</ThemedText>
              </View>
            ) : null}

            {shop.openingHours ? (
              <View style={styles.infoRow}>
                <AppIcon name="history" color={theme.textSecondary} size={16} />
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>Hours: {shop.openingHours}</ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        <LoyaltyCard providerId={shop.id} />

        <View style={styles.sectionMargin}>
          <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Store Catalog</ThemedText>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={['All Items', ...shop.categories]}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.chipScroll}
            renderItem={({ item }) => {
              const isSelected = (item === 'All Items' && selectedCategory === null) || selectedCategory === item;
              return (
                <FilterChip
                  label={item}
                  selected={isSelected}
                  onPress={() => setSelectedCategory(item === 'All Items' ? null : item)}
                />
              );
            }}
          />
        </View>

        <View style={styles.productsGrid}>
          {filteredProducts.map((item) => {
            const isFav = isFavourite('PRODUCT', item.id);
            const cartItem = items.find((cartLine) => cartLine.product.id === item.id);
            const qtyInCart = cartItem?.quantity ?? 0;
            const variant = item.variants[0];
            const eligible = isCommerceEligible(item);

            return (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/commerce/product-detail?id=${item.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ₹${item.price}`}
                style={({ pressed }) => [
                  styles.productCard,
                  shadows.raised,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
              >
                <ResilientRemoteImage
                  uri={item.imageUrl}
                  fallbackUri={fallbackForProduct(item)}
                  style={styles.productImg}
                />
                <View style={styles.productMeta}>
                  <ThemedText style={[styles.productTitle, { color: theme.text }]} numberOfLines={2}>
                    {item.name}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                    {item.brand ? `${item.brand} · ` : ''}₹{item.price}
                  </ThemedText>
                  <View style={styles.cardActions}>
                    <Pressable
                      onPress={() => void toggleFavourite('PRODUCT', item.id)}
                      style={[styles.smallIconBtn, { backgroundColor: isFav ? theme.primarySoft : theme.muted }]}
                      accessibilityLabel={isFav ? 'Remove from favourites' : 'Add to favourites'}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isFav }}
                    >
                      <AppIcon name="heart" color={isFav ? theme.danger : theme.textSecondary} size={16} />
                    </Pressable>
                    {eligible ? (
                      qtyInCart > 0 ? (
                        <View style={[styles.inlineStepper, { backgroundColor: theme.primarySoft }]}>
                          <Pressable onPress={() => updateQuantity(item.id, undefined, qtyInCart - 1)} style={styles.stepTouch}>
                            <ThemedText style={{ color: theme.primary, fontWeight: '700' }}>-</ThemedText>
                          </Pressable>
                          <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>{qtyInCart}</ThemedText>
                          <Pressable onPress={() => updateQuantity(item.id, undefined, qtyInCart + 1)} style={styles.stepTouch}>
                            <ThemedText style={{ color: theme.primary, fontWeight: '700' }}>+</ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <PrimaryButton
                          label="Add"
                          style={{ minHeight: 36, paddingHorizontal: 12 }}
                          onPress={() => addToCart(item, variant)}
                        />
                      )
                    ) : (
                      <StatusBadge
                        label={item.kind === 'MEDICINE' || item.commerceMode === 'VIEW_ONLY' ? 'VIEW ONLY' : 'UNAVAILABLE'}
                        color={theme.textSecondary}
                      />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {isCartFromThisShop ? (
        <View style={[styles.cartBanner, shadows.raised, { backgroundColor: theme.primary }]}>
          <View>
            <ThemedText style={{ color: '#FFFFFF', fontWeight: '700' }}>
              {totalItemsCount} {totalItemsCount === 1 ? 'Item' : 'Items'} | ₹{subtotalAmount}
            </ThemedText>
            <ThemedText style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>Items in cart</ThemedText>
          </View>
          <Pressable onPress={() => router.push('/cart' as never)} style={styles.viewCartBtn}>
            <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>View Cart →</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: spacing.x4, gap: spacing.x4, paddingBottom: 90 },
  heroCard: { borderRadius: radii.card, borderWidth: 1, overflow: 'hidden' },
  heroImage: { width: '100%', height: 160 },
  heroBody: { padding: spacing.x3, gap: spacing.x2 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.x2 },
  shopName: { ...typography.headline, fontSize: 18, fontWeight: '800' },
  favBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  sectionMargin: { gap: spacing.x2, marginTop: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 16, fontWeight: '700' },
  chipScroll: { gap: spacing.x2, paddingRight: spacing.x2 },
  productsGrid: { gap: spacing.x3 },
  productCard: { borderRadius: radii.card, borderWidth: 1, padding: spacing.x3, flexDirection: 'row', gap: spacing.x3 },
  productImg: { width: 80, height: 80, borderRadius: radii.compact },
  productMeta: { flex: 1, gap: 4 },
  productTitle: { ...typography.body, fontWeight: '700' },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  smallIconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  inlineStepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.pill, paddingHorizontal: 8, height: 32, gap: 8 },
  stepTouch: { paddingHorizontal: 6, paddingVertical: 2 },
  cartBanner: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: radii.card, paddingHorizontal: spacing.x4, paddingVertical: spacing.x3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewCartBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, borderRadius: radii.compact },
  pressed: { opacity: 0.88 },
});