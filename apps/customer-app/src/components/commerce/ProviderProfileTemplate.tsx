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
import { DEMO_MEDIA } from '@/services/demo-customer-data';

interface ProviderProfileTemplateProps {
  shop: ShopProfileData;
}

function fallbackForProduct(product: CommerceProduct): string {
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
      <ScreenHeader title={shop.name} subtitle="Verified Pet Partner" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ResilientRemoteImage uri={shop.heroImageUrl} fallbackUri={DEMO_MEDIA.store} style={styles.heroImage} />

          <View style={styles.heroBody}>
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.shopName, { color: theme.text }]}>{shop.name}</ThemedText>
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>{shop.tagline}</ThemedText>
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
              <StatusBadge label={`${shop.rating} (${shop.reviewCount} reviews)`} color={theme.warning} />
              <StatusBadge label={shop.deliveryEta} color={theme.success} />
              {shop.isVerified ? <StatusBadge label="Verified Partner" color={theme.primary} /> : null}
            </View>

            <View style={styles.infoRow}>
              <AppIcon name="location" color={theme.primary} size={16} />
              <ThemedText style={{ fontSize: 13, color: theme.textSecondary, flex: 1 }}>{shop.address}</ThemedText>
            </View>

            <View style={styles.infoRow}>
              <AppIcon name="history" color={theme.textSecondary} size={16} />
              <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>Hours: {shop.openingHours}</ThemedText>
            </View>
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
                  style={styles.productImage}
                />
                <Pressable
                  onPress={() => void toggleFavourite('PRODUCT', item.id)}
                  style={[styles.prodFavBadge, { backgroundColor: theme.background }]}
                  accessibilityRole="button"
                  accessibilityLabel={isFav ? 'Remove product from favourites' : 'Add product to favourites'}
                  accessibilityState={{ selected: isFav }}
                >
                  <AppIcon name={isFav ? 'check' : 'heart'} color={isFav ? theme.danger : theme.textSecondary} size={16} />
                </Pressable>

                <View style={styles.productInfo}>
                  <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>{item.brand}</ThemedText>
                  <ThemedText style={[styles.productTitle, { color: theme.text }]} numberOfLines={2}>
                    {item.name}
                  </ThemedText>

                  <View style={styles.priceRow}>
                    <ThemedText style={[styles.price, { color: theme.primary }]}>₹{item.price}</ThemedText>
                    {item.originalPrice ? <ThemedText style={styles.strikethrough}>₹{item.originalPrice}</ThemedText> : null}
                  </View>

                  {qtyInCart > 0 ? (
                    <View style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
                      <Pressable
                        onPress={() => updateQuantity(item.id, variant?.id, qtyInCart - 1)}
                        style={styles.stepBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${item.name} quantity`}
                      >
                        <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>-</ThemedText>
                      </Pressable>
                      <ThemedText style={{ color: theme.primary, fontWeight: '700', paddingHorizontal: 6 }}>{qtyInCart}</ThemedText>
                      <Pressable
                        onPress={() => updateQuantity(item.id, variant?.id, qtyInCart + 1)}
                        style={styles.stepBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${item.name} quantity`}
                      >
                        <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>+</ThemedText>
                      </Pressable>
                    </View>
                  ) : (
                    <PrimaryButton
                      label={variant?.inStock ? 'ADD' : 'OUT OF STOCK'}
                      disabled={!variant?.inStock}
                      onPress={() => {
                        if (variant) addToCart(item, variant);
                      }}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {isCartFromThisShop ? (
        <View style={[styles.stickyCart, shadows.raised, { backgroundColor: theme.primary }]}>
          <View>
            <ThemedText style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
              {totalItemsCount} {totalItemsCount === 1 ? 'Item' : 'Items'} | ₹{subtotalAmount}
            </ThemedText>
            <ThemedText style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{shop.name}</ThemedText>
          </View>
          <Pressable
            onPress={() => router.push('/cart' as never)}
            style={styles.viewCartBtn}
            accessibilityRole="button"
            accessibilityLabel="View Cart"
          >
            <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>View Cart →</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.x3 },
  scrollContent: { paddingBottom: 90, gap: spacing.x4 },
  heroCard: { borderRadius: radii.card, borderWidth: 1, overflow: 'hidden' },
  heroImage: { width: '100%', height: 140 },
  heroBody: { padding: spacing.x4, gap: spacing.x2 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shopName: { ...typography.headline, fontSize: 18, fontWeight: '800' },
  favBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', gap: spacing.x2, flexWrap: 'wrap' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  sectionMargin: { gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 16, fontWeight: '700' },
  chipScroll: { gap: spacing.x2, paddingVertical: spacing.x1 },
  productsGrid: { gap: spacing.x3 },
  productCard: { flexDirection: 'row', padding: spacing.x3, borderRadius: radii.card, borderWidth: 1, gap: spacing.x3, position: 'relative' },
  productImage: { width: 90, height: 90, borderRadius: radii.compact },
  prodFavBadge: { position: 'absolute', top: 8, left: 8, borderRadius: 12, padding: 4, elevation: 2 },
  productInfo: { flex: 1, gap: 4 },
  productTitle: { ...typography.headline, fontSize: 14, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, marginTop: 2 },
  price: { fontSize: 15, fontWeight: '800' },
  strikethrough: { textDecorationLine: 'line-through', fontSize: 12, color: '#888888' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: 4, height: 36, marginTop: 4, alignSelf: 'flex-start' },
  stepBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  stickyCart: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: radii.card, paddingHorizontal: spacing.x4, paddingVertical: spacing.x3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewCartBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, borderRadius: radii.compact },
  pressed: { opacity: 0.88 },
});