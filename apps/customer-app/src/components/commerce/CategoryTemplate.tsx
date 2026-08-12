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
import { ScreenShell } from '@/components/foundation/screen-shell';
import { FilterChip, StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { BottomTabInset } from '@/constants/theme';
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
import { DEMO_MEDIA } from '@/services/demo-customer-data';

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
    () => Array.from(new Set(products.map((product) => product.brand))).sort(),
    [products],
  );

  const filteredProducts = useMemo(() => {
    let list = [...products];
    const query = searchQuery.toLowerCase().trim();

    if (query) {
      list = list.filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          product.brand.toLowerCase().includes(query) ||
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
      list.sort((a, b) => Number.parseFloat(b.rating) - Number.parseFloat(a.rating));
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
    {
      id: 'RATING',
      label: 'Top rated',
      active: selectedSort === 'RATING',
      onPress: () => setSelectedSort(selectedSort === 'RATING' ? 'RELEVANCE' : 'RATING'),
    },
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
      header={<ScreenHeader title={title} subtitle={subtitle ?? 'Same-day local delivery'} />}
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

        {isFoodCatalog ? (
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

            return (
              <Pressable
                onPress={() => router.push(`/commerce/product-detail?id=${item.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}. ${item.brand}. ₹${item.price}. ${item.inStock ? 'In stock' : 'Out of stock'}.`}
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
                      {item.brand}
                    </ThemedText>
                    <StatusBadge label={item.rating} color={theme.warning} />
                  </View>

                  <ThemedText style={[styles.productName, { color: theme.text }]} numberOfLines={2}>{item.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.deliveryTime} · {item.providerName}
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

                    {quantity > 0 ? (
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
                        disabled={!item.inStock}
                        onPress={() => addToCart(item, item.variants[0])}
                        style={styles.addButton}
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
  shellContent: { paddingHorizontal: spacing.x4, paddingTop: spacing.x3, gap: spacing.x3 },
  controls: { gap: spacing.x2 },
  flex: { flex: 1, minWidth: 0 },
  searchBox: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: 1, borderRadius: radii.card, paddingLeft: spacing.x4, paddingRight: spacing.x1 },
  searchInput: { flex: 1, minHeight: 54, ...typography.body, paddingVertical: 0 },
  iconButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexGrow: 0, minHeight: touchTarget },
  chipList: { gap: spacing.x2, paddingRight: spacing.x6 },
  productList: { flex: 1 },
  listContent: { gap: spacing.x3, paddingBottom: BottomTabInset + spacing.x8 },
  columnRow: { gap: spacing.x3 },
  productCard: { flex: 1, minHeight: 164, flexDirection: 'row', alignItems: 'stretch', borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.x3, gap: spacing.x3, overflow: 'hidden' },
  productCardWide: { flexDirection: 'column', minWidth: 0 },
  imageContainer: { width: 112, minHeight: 132, borderRadius: radii.compact, overflow: 'hidden', position: 'relative', alignSelf: 'stretch' },
  imageContainerWide: { width: '100%', height: 190 },
  productImage: { width: '100%', height: '100%' },
  favouriteButton: { position: 'absolute', top: spacing.x1, right: spacing.x1, width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  newArrivalTag: { position: 'absolute', bottom: spacing.x2, left: spacing.x2, borderRadius: radii.pill, paddingHorizontal: spacing.x2, paddingVertical: spacing.x1 },
  productDetails: { flex: 1, minWidth: 0, gap: spacing.x1 },
  brandRow: { minHeight: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.x2 },
  productName: { ...typography.label, fontSize: 15, lineHeight: 21, flexShrink: 1 },
  priceFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: spacing.x2, marginTop: 'auto' },
  priceBlock: { flex: 1, minWidth: 0 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.x1 },
  priceText: { ...typography.title, fontSize: 18, lineHeight: 24 },
  strikethrough: { textDecorationLine: 'line-through' },
  stepper: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact },
  stepButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  addButton: { minWidth: 84, minHeight: touchTarget, paddingHorizontal: spacing.x3 },
  pressed: { opacity: 0.82 },
});
