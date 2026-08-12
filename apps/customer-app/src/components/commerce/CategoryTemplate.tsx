import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

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
import {
  radii,
  shadows,
  spacing,
  touchTarget,
  typography,
} from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CommerceProduct } from '@/services/catalog-data';
import { isCommerceEligible } from '@/services/commerce-eligibility';
import { DEMO_MEDIA } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';

interface CategoryTemplateProps {
  title: string;
  subtitle?: string;
  products: CommerceProduct[];
}

type SortMode = 'RELEVANCE' | 'PRICE_LOW' | 'PRICE_HIGH' | 'RATING';
type FoodFilter = 'ALL' | 'DRY' | 'WET' | 'PUPPY' | 'ADULT' | 'SENIOR';

const FOOD_FILTERS: ReadonlyArray<{ id: FoodFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'DRY', label: 'Dry Food' },
  { id: 'WET', label: 'Wet Food' },
  { id: 'PUPPY', label: 'Puppy' },
  { id: 'ADULT', label: 'Adult' },
  { id: 'SENIOR', label: 'Senior' },
];

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

export function CategoryTemplate({
  title,
  subtitle,
  products,
}: CategoryTemplateProps) {
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { addToCart, items, updateQuantity } = useCart();
  const { isFavourite, toggleFavourite } = useFavourites();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState<SortMode>('RELEVANCE');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedFoodFilter, setSelectedFoodFilter] = useState<FoodFilter>('ALL');

  const columns = width >= 840 ? 2 : 1;
  const isFoodCatalog = useMemo(
    () => title.toLowerCase().includes('food') || products.some((product) => product.category === 'food'),
    [products, title],
  );

  const brands = useMemo(
    () => Array.from(new Set(products.map((product) => product.brand).filter((b): b is string => Boolean(b)))).sort(),
    [products],
  );

  const filteredProducts = useMemo(() => {
    let list = [...products];
    const query = searchQuery.toLowerCase().trim();

    if (query) {
      list = list.filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          (product.brand && product.brand.toLowerCase().includes(query)) ||
          product.providerName.toLowerCase().includes(query),
      );
    }

    if (inStockOnly) list = list.filter((product) => product.inStock);
    if (selectedBrand) list = list.filter((product) => product.brand === selectedBrand);

    if (isFoodCatalog && selectedFoodFilter !== 'ALL') {
      if (selectedFoodFilter === 'DRY' || selectedFoodFilter === 'WET') {
        list = list.filter((product) => product.foodForm === selectedFoodFilter);
      } else {
        list = list.filter((product) => product.lifeStages?.includes(selectedFoodFilter));
      }
    }

    if (selectedSort === 'PRICE_LOW') list.sort((a, b) => a.price - b.price);
    if (selectedSort === 'PRICE_HIGH') list.sort((a, b) => b.price - a.price);
    if (selectedSort === 'RATING') {
      list.sort((a, b) => Number.parseFloat(b.rating ?? '0') - Number.parseFloat(a.rating ?? '0'));
    }

    return list;
  }, [
    inStockOnly,
    isFoodCatalog,
    products,
    searchQuery,
    selectedBrand,
    selectedFoodFilter,
    selectedSort,
  ]);

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedBrand(null);
    setSelectedSort('RELEVANCE');
    setInStockOnly(false);
    setSelectedFoodFilter('ALL');
  };

  const utilityFilters = [
    { id: 'ALL_BRANDS', label: 'All brands', active: selectedBrand === null, onPress: () => setSelectedBrand(null) },
    { id: 'STOCK', label: 'In stock', active: inStockOnly, onPress: () => setInStockOnly((value) => !value) },
    {
      id: 'LOW',
      label: 'Price: low to high',
      active: selectedSort === 'PRICE_LOW',
      onPress: () => setSelectedSort(selectedSort === 'PRICE_LOW' ? 'RELEVANCE' : 'PRICE_LOW'),
    },
    {
      id: 'HIGH',
      label: 'Price: high to low',
      active: selectedSort === 'PRICE_HIGH',
      onPress: () => setSelectedSort(selectedSort === 'PRICE_HIGH' ? 'RELEVANCE' : 'PRICE_HIGH'),
    },
    ...(appConfig.allowDemoMode
      ? [{
          id: 'RATING',
          label: 'Top rated',
          active: selectedSort === 'RATING',
          onPress: () => setSelectedSort(selectedSort === 'RATING' ? 'RELEVANCE' : 'RATING'),
        }]
      : []),
    ...brands.map((brand) => ({
      id: `brand-${brand}`,
      label: brand,
      active: selectedBrand === brand,
      onPress: () => setSelectedBrand(selectedBrand === brand ? null : brand),
    })),
  ];

  return (
    <ScreenShell
      scroll={false}
      header={<ScreenHeader title={title} subtitle={subtitle ?? 'Live stock & store pickup'} />}
      contentContainerStyle={styles.shellContent}
      testID="customer-category-screen"
    >
      <View style={styles.controls}>
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <AppIcon name="search" color={theme.textSecondary} size={20} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Search ${title.toLowerCase()}…`}
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            returnKeyType="search"
            accessibilityLabel={`Search ${title}`}
            maxFontSizeMultiplier={1.6}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <AppIcon name="close" color={theme.textSecondary} size={18} />
            </Pressable>
          ) : null}
        </View>

        {isFoodCatalog && appConfig.allowDemoMode ? (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={FOOD_FILTERS}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.chipList}
            style={styles.chipRow}
            renderItem={({ item }) => (
              <FilterChip
                label={item.label}
                selected={selectedFoodFilter === item.id}
                onPress={() => setSelectedFoodFilter(item.id)}
              />
            )}
          />
        ) : null}

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={utilityFilters}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chipList}
          style={styles.chipRow}
          renderItem={({ item }) => <FilterChip label={item.label} selected={item.active} onPress={item.onPress} />}
        />
      </View>

      {filteredProducts.length === 0 ? (
        <StateView
          kind="empty"
          title="No matching products"
          message="Clear one or more filters to see products available from verified local stores."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <FlatList
          key={`catalog-${columns}`}
          style={styles.productList}
          data={filteredProducts}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          columnWrapperStyle={columns > 1 ? styles.columnRow : undefined}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const favourite = isFavourite('PRODUCT', item.id);
            const cartItem = items.find((entry) => entry.product.id === item.id);
            const quantity = cartItem?.quantity ?? 0;
            const eligible = isCommerceEligible(item);

            return (
              <Pressable
                onPress={() => router.push(`/commerce/product-detail?id=${item.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}. ${item.brand ? `${item.brand}. ` : ''}₹${item.price}. ${item.inStock ? 'In stock' : 'Out of stock'}.`}
                style={({ pressed }) => [
                  styles.productCard,
                  columns > 1 && styles.productCardWide,
                  shadows.card,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.imageContainer,
                    columns > 1 && styles.imageContainerWide,
                    { backgroundColor: theme.muted },
                  ]}
                >
                  <ResilientRemoteImage
                    uri={item.imageUrl}
                    fallbackUri={fallbackForProduct(item)}
                    style={styles.productImage}
                  />
                  <Pressable
                    onPress={() => void toggleFavourite('PRODUCT', item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={favourite ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`}
                    accessibilityState={{ selected: favourite }}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.favouriteButton,
                      { backgroundColor: theme.backgroundElement },
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppIcon name="heart" color={favourite ? theme.danger : theme.textSecondary} size={20} />
                  </Pressable>
                  {item.isNewArrival ? (
                    <View style={[styles.newArrivalTag, { backgroundColor: theme.accentSoft }]}>
                      <ThemedText type="small" style={{ color: theme.accent, fontWeight: '800' }}>New</ThemedText>
                    </View>
                  ) : null}
                </View>

                <View style={styles.productDetails}>
                  <View style={styles.brandRow}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
                      {item.brand || item.providerName}
                    </ThemedText>
                    {item.rating ? <StatusBadge label={item.rating} color={theme.warning} /> : null}
                  </View>

                  <ThemedText style={[styles.productName, { color: theme.text }]} numberOfLines={2}>{item.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.deliveryTime ? `${item.deliveryTime} · ` : ''}{item.providerName}
                  </ThemedText>

                  <View style={styles.priceFooter}>
                    <View style={styles.priceBlock}>
                      <View style={styles.priceRow}>
                        <ThemedText style={[styles.priceText, { color: theme.primary }]}>₹{item.price}</ThemedText>
                        {item.originalPrice ? (
                          <ThemedText type="small" style={[styles.strikethrough, { color: theme.textSecondary }]}>₹{item.originalPrice}</ThemedText>
                        ) : null}
                      </View>
                      <ThemedText
                        type="small"
                        numberOfLines={1}
                        style={{ color: item.inStock ? theme.success : theme.danger, fontWeight: '700' }}
                      >
                        {item.inStock ? `${item.stockCount} available` : 'Out of stock'}
                      </ThemedText>
                    </View>

                    {eligible ? (
                      quantity > 0 ? (
                        <View
                          style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}
                          accessibilityRole="adjustable"
                          accessibilityLabel={`${item.name} quantity`}
                          accessibilityValue={{ min: 0, now: quantity }}
                        >
                          <Pressable
                            onPress={() => updateQuantity(item.id, undefined, quantity - 1)}
                            accessibilityRole="button"
                            accessibilityLabel={`Decrease ${item.name} quantity`}
                            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                          >
                            <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>−</ThemedText>
                          </Pressable>
                          <ThemedText style={{ color: theme.primary, fontWeight: '800', minWidth: 22, textAlign: 'center' }}>{quantity}</ThemedText>
                          <Pressable
                            onPress={() => updateQuantity(item.id, undefined, quantity + 1)}
                            accessibilityRole="button"
                            accessibilityLabel={`Increase ${item.name} quantity`}
                            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                          >
                            <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>+</ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <PrimaryButton
                          label="Add"
                          style={{ minHeight: 36, paddingHorizontal: 12 }}
                          onPress={() => addToCart(item, item.variants[0])}
                        />
                      )
                    ) : (
                      <StatusBadge
                        label={
                          item.kind === 'MEDICINE' || item.commerceMode === 'VIEW_ONLY'
                            ? 'VIEW ONLY'
                            : item.pickupEnabled === false
                              ? 'NO PICKUP'
                              : 'OUT OF STOCK'
                        }
                        color={theme.textSecondary}
                      />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: { gap: spacing.x3, paddingHorizontal: spacing.x4, paddingBottom: spacing.x4 },
  controls: { gap: spacing.x2 },
  searchBox: {
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 0,
  },
  chipRow: { maxHeight: 36 },
  chipList: { gap: spacing.x2, paddingRight: spacing.x2 },
  productList: { flex: 1 },
  listContent: { gap: spacing.x3, paddingBottom: spacing.x6 },
  columnRow: { gap: spacing.x3 },
  productCard: {
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
    gap: spacing.x2,
  },
  productCardWide: {
    flex: 1,
  },
  imageContainer: {
    height: 180,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  imageContainerWide: {
    height: 160,
  },
  productImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  favouriteButton: {
    position: 'absolute',
    top: spacing.x2,
    right: spacing.x2,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  newArrivalTag: {
    position: 'absolute',
    top: spacing.x2,
    left: spacing.x2,
    paddingHorizontal: spacing.x2,
    paddingVertical: 2,
    borderRadius: radii.compact,
  },
  productDetails: {
    padding: spacing.x3,
    gap: spacing.x1,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  productName: {
    ...typography.headline,
    fontSize: 15,
    fontWeight: '700',
  },
  priceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.x2,
  },
  priceBlock: {
    gap: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.x1,
  },
  priceText: {
    ...typography.headline,
    fontSize: 17,
    fontWeight: '800',
  },
  strikethrough: {
    textDecorationLine: 'line-through',
    fontSize: 12,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 36,
    paddingHorizontal: 4,
  },
  stepButton: {
    minWidth: 28,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});
