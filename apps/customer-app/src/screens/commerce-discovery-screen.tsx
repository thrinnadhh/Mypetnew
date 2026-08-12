import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  fetchPublicOutlets,
  type PublicOutletSummary,
} from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

const COMMERCE_CATEGORIES = [
  { id: 'food', title: 'Food', icon: 'food' },
  { id: 'furniture', title: 'Furniture', icon: 'home' },
  { id: 'toys', title: 'Toys', icon: 'sparkle' },
  { id: 'travel', title: 'Travel', icon: 'location' },
  { id: 'treats', title: 'Treats', icon: 'paw' },
  { id: 'waste', title: 'Waste', icon: 'warning' },
  { id: 'new-arrivals', title: 'New', icon: 'sparkle' },
];

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
            onPress={() => router.push(`/category/${category.id}` as never)}
            style={({ pressed }) => [styles.catItem, pressed && styles.pressed]}
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

function LiveStoreCards({ stores }: { stores: PublicOutletSummary[] }) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Available Pet Stores</ThemedText>
      <View style={styles.shopGrid}>
        {stores.map((store) => (
          <Pressable
            key={store.id}
            onPress={() => router.push(`/shop/${store.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`${store.name}, ${store.pickupEnabled ? 'Store pickup available' : 'Pickup unavailable'}`}
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
              <View style={styles.rowBetween}>
                <ThemedText style={[styles.shopTitle, { color: theme.text }]} numberOfLines={1}>
                  {store.name}
                </ThemedText>
                <StatusBadge
                  label={store.pickupEnabled ? 'Pickup Available' : 'Pickup Unavailable'}
                  color={store.pickupEnabled ? theme.success : theme.textSecondary}
                />
              </View>
              <View style={styles.rowBetween}>
                <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                  Product Store
                </ThemedText>
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
  const { providerName, totalItemsCount, subtotalAmount } = useCart();
  const [stores, setStores] = useState<PublicOutletSummary[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetchPublicOutlets({ capability: 'PRODUCT_STORE' });
      setStores(response.items);
      setState('ready');
    } catch (error) {
      setStores([]);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScreenShell
      header={<AppBar title={t('commerceFoundation.title')} subtitle="Available Pet Stores" />}
      testID="commerce-discovery-screen"
    >
      <View style={styles.container}>
        <ShopCategoryNav />
        {state === 'loading' ? (
          <StateView kind="loading" title="Finding active pet stores" />
        ) : null}
        {state === 'offline' || state === 'error' ? (
          <StateView
            kind={state}
            title={state === 'offline' ? 'You are offline' : 'Stores unavailable'}
            message={state === 'offline' ? 'Reconnect to load live stores.' : 'Could not load active pet stores.'}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : null}
        {state === 'ready' && stores.length === 0 ? (
          <StateView
            kind="empty"
            title="No active pet stores available"
            message="No active pet stores are currently available."
          />
        ) : null}
        {state === 'ready' && stores.length > 0 ? <LiveStoreCards stores={stores} /> : null}
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
  catItem: { width: 68, alignItems: 'center', gap: 4 },
  catIconBox: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  shopGrid: { gap: spacing.x3 },
  shopCard: { borderRadius: radii.card, borderWidth: 1, padding: spacing.x3, flexDirection: 'row', gap: spacing.x3 },
  storeIcon: { width: 64, height: 64, borderRadius: radii.card, alignItems: 'center', justifyContent: 'center' },
  shopContent: { flex: 1, gap: spacing.x2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2 },
  shopTitle: { ...typography.headline, fontSize: 16, fontWeight: '700', flex: 1 },
  stickyCart: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: radii.card, paddingHorizontal: spacing.x4, paddingVertical: spacing.x3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewCartBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, borderRadius: radii.compact },
  pressed: { opacity: 0.88 },
});
