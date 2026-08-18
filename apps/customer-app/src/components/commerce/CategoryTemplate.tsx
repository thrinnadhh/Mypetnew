import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { PublicCatalogQuery } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';
import { DEMO_MEDIA } from '@/services/demo-customer-data';
import {
  CUSTOMER_CATALOG_PAGE_SIZE,
  fetchCommerceCatalogPage,
  mergeUniqueProducts,
} from '@/services/paginated-catalog';
import { appConfig } from '@/utils/app-config';

interface CategoryTemplateProps {
  title: string;
  subtitle?: string;
  catalogQuery: PublicCatalogQuery;
  backFallback?: string;
}

type SortMode = 'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC';
type LoadState = 'loading' | 'ready' | 'offline' | 'error';

type FoodFilter = 'ALL' | 'DRY' | 'WET' | 'PUPPY' | 'ADULT' | 'SENIOR';

const FOOD_FILTERS: ReadonlyArray<{ id: FoodFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'DRY', label: 'Dry Food' },
  { id: 'WET', label: 'Wet Food' },
  { id: 'PUPPY', label: 'Puppy' },
  { id: 'ADULT', label: 'Adult' },
  { id: 'SENIOR', label: 'Senior' },
];

function fallbackForProduct(product: CommerceProduct): string | undefined {
  if (!appConfig.allowDemoMode) return undefined;
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
  catalogQuery,
  backFallback = '/stores',
}: CategoryTemplateProps) {
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { addToCart, items, updateQuantity } = useCart();
  const { isFavourite, toggleFavourite } = useFavourites();

  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSort, setSelectedSort] = useState<SortMode>('DEFAULT');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [selectedFoodFilter, setSelectedFoodFilter] = useState<FoodFilter>('ALL');
  const [hasNext, setHasNext] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const requestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);
  const columns = width >= 840 ? 2 : 1;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const requestKey = JSON.stringify({
    ...catalogQuery,
    q: debouncedSearch || undefined,
    availability: inStockOnly ? 'IN_STOCK' : catalogQuery.availability,
    sort:
      selectedSort === 'DEFAULT'
        ? catalogQuery.sort
        : selectedSort,
    pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
  });

  const requestQuery = useMemo(
    () => JSON.parse(requestKey) as PublicCatalogQuery,
    [requestKey],
  );

  const loadFirstPage = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    setState('loading');
    setProducts([]);

    try {
      const response = await fetchCommerceCatalogPage({
        ...requestQuery,
        page: 0,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setProducts(response.items);
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setProducts([]);
      setHasNext(false);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [requestQuery]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadNextPage = useCallback(async () => {
    if (!hasNext || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const generation = requestGeneration.current;

    try {
      const response = await fetchCommerceCatalogPage({
        ...requestQuery,
        page: nextPage,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setProducts((current) => mergeUniqueProducts(current, response.items));
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setLoadMoreError(
        isOfflineError(error)
          ? 'Reconnect to load more products.'
          : 'Could not load the next page.',
      );
    } finally {
      if (requestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasNext, nextPage, requestQuery]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(backFallback as never);
  }, [backFallback, router]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setSelectedSort('DEFAULT');
    setInStockOnly(false);
    setSelectedFoodFilter('ALL');
  }, []);

  const isFoodCatalog = title.toLowerCase().includes('food');
  const visibleProducts = useMemo(() => {
    if (!appConfig.allowDemoMode || !isFoodCatalog || selectedFoodFilter === 'ALL') {
      return products;
    }
    if (selectedFoodFilter === 'DRY' || selectedFoodFilter === 'WET') {
      return products.filter((product) => product.foodForm === selectedFoodFilter);
    }
    return products.filter((product) => product.lifeStages?.includes(selectedFoodFilter));
  }, [isFoodCatalog, products, selectedFoodFilter]);

  const hasActiveFilters = Boolean(
    debouncedSearch
    || inStockOnly
    || selectedSort !== 'DEFAULT'
    || selectedFoodFilter !== 'ALL',
  );

  const utilityFilters = [
    {
      id: 'STOCK',
      label: 'In stock',
      active: inStockOnly,
      onPress: () => setInStockOnly((value) => !value),
    },
    {
      id: 'LOW',
      label: 'Price: low to high',
      active: selectedSort === 'PRICE_ASC',
      onPress: () => setSelectedSort(selectedSort === 'PRICE_ASC' ? 'DEFAULT' : 'PRICE_ASC'),
    },
    {
      id: 'HIGH',
      label: 'Price: high to low',
      active: selectedSort === 'PRICE_DESC',
      onPress: () => setSelectedSort(selectedSort === 'PRICE_DESC' ? 'DEFAULT' : 'PRICE_DESC'),
    },
  ];

  if (state === 'loading') {
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title={title} subtitle={subtitle} onBack={goBack} />}
        contentContainerStyle={styles.shellContent}
      >
        <StateView
          kind="loading"
          title="Loading live products"
          message="Checking current stock and prices from verified local stores…"
        />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell
        scroll={false}
        header={<ScreenHeader title={title} subtitle={subtitle} onBack={goBack} />}
        contentContainerStyle={styles.shellContent}
      >
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Catalog unavailable'}
          message={
            state === 'offline'
              ? 'Reconnect to load current inventory and prices.'
              : 'The live catalog could not be loaded.'
          }
          actionLabel="Retry"
          onAction={() => void loadFirstPage()}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      scroll={false}
      header={<ScreenHeader title={title} subtitle={subtitle ?? 'Live stock & store pickup'} onBack={goBack} />}
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
          renderItem={({ item }) => (
            <FilterChip label={item.label} selected={item.active} onPress={item.onPress} />
          )}
        />
      </View>

      {visibleProducts.length === 0 ? (
        <StateView
          kind="empty"
          title={hasActiveFilters ? 'No matching products' : 'No products available'}
          message={
            hasActiveFilters
              ? 'Clear one or more filters to see other products available from verified local stores.'
              : 'This catalogue does not have any public listings right now.'
          }
          actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
          onAction={hasActiveFilters ? clearFilters : undefined}
        />
      ) : (
        <FlatList
          key={`catalog-${columns}`}
          style={styles.productList}
          data={visibleProducts}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          columnWrapperStyle={columns > 1 ? styles.columnRow : undefined}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasNext && !loadMoreError) void loadNextPage();
          }}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            loadMoreError ? (
              <View style={styles.paginationFooter}>
                <ThemedText type="small" themeColor="textSecondary">{loadMoreError}</ThemedText>
                <PrimaryButton
                  label="Retry loading more"
                  variant="secondary"
                  onPress={() => void loadNextPage()}
                />
              </View>
            ) : hasNext ? (
              <View style={styles.paginationFooter}>
                <PrimaryButton
                  label="Load more products"
                  variant="secondary"
                  loading={loadingMore}
                  onPress={() => void loadNextPage()}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const favourite = isFavourite('PRODUCT', item.id);
            const cartItem = items.find((entry) => entry.product.id === item.id);
            const quantity = cartItem?.quantity ?? 0;
            const eligible = isCommerceEligible(item);

            return (
              <Pressable
                onPress={() => router.push(`/commerce/product-detail?id=${encodeURIComponent(item.id)}` as never)}
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
                    {item.brand ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
                        {item.brand}
                      </ThemedText>
                    ) : (
                      <View style={styles.flex} />
                    )}
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
                          style={{ paddingHorizontal: 12 }}
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
    minHeight: touchTarget,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingLeft: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  searchInput: {
    flex: 1,
    minHeight: touchTarget,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 0,
  },
  chipRow: { minHeight: touchTarget },
  chipList: { gap: spacing.x2, paddingRight: spacing.x2 },
  productList: { flex: 1 },
  listContent: { gap: spacing.x3, paddingBottom: spacing.x6 },
  columnRow: { gap: spacing.x3 },
  paginationFooter: { gap: spacing.x2, paddingVertical: spacing.x3, alignItems: 'stretch' },
  productCard: {
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
    gap: spacing.x2,
  },
  productCardWide: { flex: 1 },
  imageContainer: {
    height: 180,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  imageContainerWide: { height: 160 },
  productImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  favouriteButton: {
    position: 'absolute',
    top: spacing.x2,
    right: spacing.x2,
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
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
  productDetails: { padding: spacing.x3, gap: spacing.x1 },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  productName: { ...typography.headline, fontSize: 15, fontWeight: '700' },
  priceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.x2,
  },
  priceBlock: { gap: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.x1 },
  priceText: { ...typography.headline, fontSize: 17, fontWeight: '800' },
  strikethrough: { textDecorationLine: 'line-through', fontSize: 12 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: touchTarget,
  },
  stepButton: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
