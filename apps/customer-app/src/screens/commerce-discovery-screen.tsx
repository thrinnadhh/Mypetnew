import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  fetchPublicOutlets,
  type PublicOutletSummary,
} from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

const STORE_PAGE_SIZE = 20;

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

const COMMERCE_CATEGORIES = [
  { id: 'all', title: 'All Products', icon: 'store', route: '/products' },
  { id: 'food', title: 'Food', icon: 'food', route: '/category/food' },
  { id: 'furniture', title: 'Furniture', icon: 'home', route: '/category/furniture' },
  { id: 'toys', title: 'Toys', icon: 'sparkle', route: '/category/toys' },
  { id: 'travel', title: 'Travel', icon: 'location', route: '/category/travel' },
  { id: 'treats', title: 'Treats', icon: 'paw', route: '/category/treats' },
  { id: 'waste', title: 'Waste', icon: 'warning', route: '/category/waste' },
  { id: 'medicines', title: 'Medicines', icon: 'medical', route: '/category/medicines' },
  { id: 'new-arrivals', title: 'New', icon: 'sparkle', route: '/category/new-arrivals' },
] as const;

function mergeUniqueStores(
  current: readonly PublicOutletSummary[],
  incoming: readonly PublicOutletSummary[],
): PublicOutletSummary[] {
  const byId = new Map(current.map((store) => [store.id, store]));
  for (const store of incoming) byId.set(store.id, store);
  return Array.from(byId.values());
}

export function ShopCategoryNav() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Shop by Category</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catScroll}>
        {COMMERCE_CATEGORIES.map((category) => (
          <Pressable
            key={category.id}
            onPress={() => router.push(category.route as never)}
            style={({ pressed }) => [styles.catItem, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={category.id === 'medicines' ? 'Medicines, discovery only' : category.title}
          >
            <View style={[styles.catIconBox, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
              <AppIcon name={category.icon as never} color={theme.primary} size={22} />
            </View>
            <ThemedText style={[styles.catLabel, { color: theme.text }]} numberOfLines={1}>
              {category.title}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function LiveStoreCards({
  stores,
  city,
  pincode,
}: {
  stores: PublicOutletSummary[];
  city: string;
  pincode: string;
}) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Pet Stores Near You</ThemedText>
      <View style={styles.shopGrid}>
        {stores.map((store) => (
          <Pressable
            key={store.id}
            onPress={() => router.push(`/shop/${encodeURIComponent(store.id)}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`${store.name}, serves PIN ${pincode}, ${store.pickupEnabled ? 'Store pickup available' : 'Pickup unavailable'}`}
            style={({ pressed }) => [
              styles.shopCard,
              shadows.raised,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.storeIcon, { backgroundColor: theme.primarySoft }]}>
              <AppIcon name="store" size={30} color={theme.primary} />
            </View>
            <View style={styles.shopContent}>
              <ThemedText style={[styles.shopTitle, { color: theme.text }]} numberOfLines={1}>
                {store.name}
              </ThemedText>
              <ThemedText style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
                {city} · serves PIN {pincode}
              </ThemedText>
              <View style={styles.rowBetween}>
                <StatusBadge
                  label={store.pickupEnabled ? 'Pickup Available' : 'Pickup Unavailable'}
                  color={store.pickupEnabled ? theme.success : theme.textSecondary}
                />
                <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>Explore →</ThemedText>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function CommerceDiscoveryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const { activeCity, selectedPincode } = useLocation();
  const { providerName, totalItemsCount, subtotalAmount } = useCart();
  const [stores, setStores] = useState<PublicOutletSummary[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [hasNext, setHasNext] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    setState('loading');
    setStores([]);

    if (!/^[1-9][0-9]{5}$/.test(selectedPincode)) {
      setHasNext(false);
      setState('error');
      return;
    }

    try {
      const response = await fetchPublicOutlets({
        capability: 'PRODUCT_STORE',
        pincode: selectedPincode,
        page: 0,
        pageSize: STORE_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setStores(response.items);
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setStores([]);
      setHasNext(false);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [selectedPincode]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadNextPage = useCallback(async () => {
    if (!hasNext || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const generation = requestGeneration.current;

    try {
      const response = await fetchPublicOutlets({
        capability: 'PRODUCT_STORE',
        pincode: selectedPincode,
        page: nextPage,
        pageSize: STORE_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setStores((current) => mergeUniqueStores(current, response.items));
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setLoadMoreError(
        isOfflineError(error)
          ? 'Reconnect to load more stores.'
          : 'Could not load more stores for this PIN.',
      );
    } finally {
      if (requestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasNext, nextPage, selectedPincode]);

  return (
    <ScreenShell
      header={(
        <AppBar
          title={t('commerceFoundation.title')}
          subtitle={`Pet stores serving ${selectedPincode} in ${activeCity.displayName}`}
        />
      )}
      testID="commerce-discovery-screen"
    >
      <View style={styles.container}>
        <ShopCategoryNav />
        {state === 'loading' ? (
          <StateView kind="loading" title="Finding active pet stores" message={`Checking active product stores serving PIN ${selectedPincode}.`} />
        ) : null}
        {state === 'offline' || state === 'error' ? (
          <StateView
            kind={state}
            title={state === 'offline' ? 'You are offline' : 'Stores unavailable'}
            message={
              state === 'offline'
                ? 'Reconnect to load live stores.'
                : 'Select a valid active service PIN and retry.'
            }
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : null}
        {state === 'ready' && stores.length === 0 ? (
          <StateView
            kind="empty"
            title={`No active pet stores serve ${selectedPincode} yet`}
            message="Choose another active service PIN to check nearby public product stores."
          />
        ) : null}
        {state === 'ready' && stores.length > 0 ? (
          <>
            <LiveStoreCards stores={stores} city={activeCity.displayName} pincode={selectedPincode} />
            {loadMoreError ? (
              <View style={styles.paginationFooter}>
                <ThemedText type="small" themeColor="textSecondary">{loadMoreError}</ThemedText>
                <PrimaryButton label="Retry loading more" variant="secondary" onPress={() => void loadNextPage()} />
              </View>
            ) : hasNext ? (
              <View style={styles.paginationFooter}>
                <PrimaryButton
                  label="Load more stores"
                  variant="secondary"
                  loading={loadingMore}
                  onPress={() => void loadNextPage()}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {totalItemsCount > 0 ? (
        <View style={[styles.stickyCart, shadows.raised, { backgroundColor: theme.primary }]}>
          <View>
            <ThemedText style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
              {totalItemsCount} {totalItemsCount === 1 ? 'Item' : 'Items'} | ₹{subtotalAmount}
            </ThemedText>
            <ThemedText style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{providerName ?? 'Cart'}</ThemedText>
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.x4, paddingBottom: 80 },
  section: { gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 16, fontWeight: '700' },
  catScroll: { gap: spacing.x3, paddingVertical: spacing.x1 },
  catItem: { minWidth: 68, minHeight: touchTarget, alignItems: 'center', gap: 4 },
  catIconBox: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  shopGrid: { gap: spacing.x3 },
  shopCard: { minHeight: touchTarget, borderRadius: radii.card, borderWidth: 1, padding: spacing.x3, flexDirection: 'row', gap: spacing.x3 },
  storeIcon: { width: 64, height: 64, borderRadius: radii.card, alignItems: 'center', justifyContent: 'center' },
  shopContent: { flex: 1, gap: spacing.x2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2 },
  shopTitle: { ...typography.headline, fontSize: 16, fontWeight: '700', flex: 1 },
  paginationFooter: { gap: spacing.x2, paddingVertical: spacing.x3 },
  stickyCart: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: radii.card, paddingHorizontal: spacing.x4, paddingVertical: spacing.x3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2 },
  viewCartBtn: { minHeight: touchTarget, backgroundColor: '#FFFFFF', paddingHorizontal: spacing.x4, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.88 },
});
