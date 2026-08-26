import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CommerceProduct } from '@/services/catalog-types';
import { isOfflineError } from '@/services/customer-profile';
import {
  CUSTOMER_CATALOG_PAGE_SIZE,
  fetchProductCatalogPage,
  mergeUniqueProducts,
} from '@/services/paginated-catalog';

const RECENT_SEARCHES_KEY = 'mypet_recent_searches_v1';
const SUGGESTED_SEARCHES = ['Adult Dog Food', 'Cat Treats', 'Chew Toys', 'Grooming Shampoo'];

type SearchState = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

export default function UniversalSearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { selectedPincode } = useLocation();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const initialParam = Array.isArray(params.q) ? params.q[0] : params.q;

  const [query, setQuery] = useState(initialParam ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState((initialParam ?? '').trim());
  const [results, setResults] = useState<CommerceProduct[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [state, setState] = useState<SearchState>(initialParam?.trim() ? 'loading' : 'idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const requestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const routeQuery = Array.isArray(params.q) ? params.q[0] : params.q;
    if (routeQuery !== undefined) setQuery(routeQuery);
  }, [params.q]);

  useEffect(() => {
    const loadRecent = async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
        if (stored) setRecentSearches(JSON.parse(stored) as string[]);
      } catch (error) {
        console.warn('Failed to load recent searches', error);
      }
    };
    void loadRecent();
  }, []);

  const saveRecentSearch = useCallback(async (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setRecentSearches((current) => {
      const filtered = current.filter((item) => item.toLowerCase() !== clean.toLowerCase());
      const next = [clean, ...filtered].slice(0, 5);
      void AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(async () => {
    setRecentSearches([]);
    await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const clean = query.trim();
      setDebouncedQuery(clean);
      router.setParams({ q: clean });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, router]);

  const loadFirstPage = useCallback(async () => {
    const normalizedQuery = debouncedQuery.trim();
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    setErrorMessage(null);

    if (!normalizedQuery) {
      setResults([]);
      setHasNext(false);
      setNextPage(1);
      setState('idle');
      return;
    }

    setState('loading');
    setResults([]);

    try {
      const response = await fetchProductCatalogPage({
        q: normalizedQuery,
        sort: 'NAME',
        pincode: selectedPincode,
        page: 0,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setResults(response.items);
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
      setState('ready');
      await saveRecentSearch(normalizedQuery);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setResults([]);
      setHasNext(false);
      setErrorMessage(error instanceof Error ? error.message : 'Search is unavailable.');
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [debouncedQuery, saveRecentSearch, selectedPincode]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadNextPage = useCallback(async () => {
    if (!debouncedQuery || !hasNext || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const generation = requestGeneration.current;

    try {
      const response = await fetchProductCatalogPage({
        q: debouncedQuery,
        sort: 'NAME',
        pincode: selectedPincode,
        page: nextPage,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setResults((current) => mergeUniqueProducts(current, response.items));
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setLoadMoreError(
        isOfflineError(error)
          ? 'Reconnect to load more matching products.'
          : 'Could not load more matching products.',
      );
    } finally {
      if (requestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [debouncedQuery, hasNext, nextPage, selectedPincode]);

  const submitSearch = useCallback(() => {
    const clean = query.trim();
    setDebouncedQuery(clean);
    router.setParams({ q: clean });
  }, [query, router]);

  const selectSuggestedSearch = useCallback((term: string) => {
    setQuery(term);
    setDebouncedQuery(term.trim());
    router.setParams({ q: term.trim() });
  }, [router]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/' as never);
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.navHeader, { borderColor: theme.border }]}>
        <Pressable
          onPress={goBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <AppIcon name="close" color={theme.text} size={20} />
        </Pressable>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <AppIcon name="search" color={theme.textSecondary} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            placeholder={`Search products serving ${selectedPincode}...`}
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            autoFocus={!initialParam}
            returnKeyType="search"
            accessibilityLabel={`Search products serving PIN ${selectedPincode}`}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <AppIcon name="close" color={theme.textSecondary} size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {state === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={{ color: theme.textSecondary, marginTop: 8 }}>Searching live products...</ThemedText>
        </View>
      ) : state === 'offline' || state === 'error' ? (
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Search unavailable'}
          message={errorMessage ?? `Could not search products serving PIN ${selectedPincode}.`}
          actionLabel="Retry"
          onAction={() => void loadFirstPage()}
        />
      ) : query.trim().length === 0 ? (
        <View style={styles.recentSection}>
          {recentSearches.length > 0 ? (
            <>
              <View style={styles.recentHeader}>
                <ThemedText style={styles.recentTitle}>Recent Searches</ThemedText>
                <Pressable
                  onPress={() => void clearRecentSearches()}
                  accessibilityRole="button"
                  accessibilityLabel="Clear all recent searches"
                  style={styles.textAction}
                >
                  <ThemedText style={{ color: theme.primary, fontSize: 13, fontWeight: '700' }}>Clear All</ThemedText>
                </Pressable>
              </View>
              <View style={styles.chipGrid}>
                {recentSearches.map((term) => (
                  <Pressable
                    key={term}
                    onPress={() => selectSuggestedSearch(term)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${term}`}
                    style={[styles.recentChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  >
                    <AppIcon name="history" color={theme.textSecondary} size={14} />
                    <ThemedText style={{ fontSize: 13, color: theme.text }}>{term}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <ThemedText style={[styles.recentTitle, { marginTop: spacing.x6 }]}>Suggested Searches</ThemedText>
          <View style={styles.chipGrid}>
            {SUGGESTED_SEARCHES.map((term) => (
              <Pressable
                key={term}
                onPress={() => selectSuggestedSearch(term)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${term}`}
                style={[styles.recentChip, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}
              >
                <AppIcon name="search" color={theme.primary} size={14} />
                <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: '600' }}>{term}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <AppIcon name="search" color={theme.textSecondary} size={40} />
          <ThemedText style={{ fontWeight: '700', fontSize: 16, marginTop: 12 }}>No matching products</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4 }}>
            No matching public products currently serve PIN {selectedPincode}.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.resultsList}
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
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/commerce/product-detail?id=${encodeURIComponent(item.id)}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}. ${item.brand ? `${item.brand}. ` : ''}₹${item.price}.`}
              style={({ pressed }) => [
                styles.resultCard,
                shadows.raised,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              <ThemedText style={[styles.resultTitle, { color: theme.text }]}>{item.name}</ThemedText>
              <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>
                {item.brand || item.providerName}
              </ThemedText>
              <View style={styles.resultFooter}>
                <ThemedText style={{ fontWeight: '700', color: theme.primary }}>₹{item.price}</ThemedText>
                <ThemedText style={{ fontSize: 12, color: item.inStock ? theme.success : theme.danger }}>
                  {item.inStock ? 'In stock' : 'Out of stock'}
                </ThemedText>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingHorizontal: spacing.x4,
    paddingTop: spacing.x6,
    paddingBottom: spacing.x3,
    borderBottomWidth: 1,
  },
  backBtn: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    borderWidth: 1,
    borderRadius: radii.compact,
    paddingLeft: spacing.x3,
    minHeight: touchTarget,
  },
  searchInput: { flex: 1, minHeight: touchTarget, ...typography.body },
  iconBtn: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.x6 },
  recentSection: { padding: spacing.x4, gap: spacing.x3 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recentTitle: { ...typography.label, fontSize: 13, color: '#888888', textTransform: 'uppercase' },
  textAction: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.x2 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  recentChip: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.compact,
    borderWidth: 1,
  },
  resultsList: { padding: spacing.x4, gap: spacing.x3 },
  resultCard: { minHeight: touchTarget, padding: spacing.x4, borderRadius: radii.card, borderWidth: 1, gap: spacing.x2 },
  resultTitle: { ...typography.headline, fontSize: 16 },
  resultFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  paginationFooter: { gap: spacing.x2, paddingVertical: spacing.x3 },
  pressed: { opacity: 0.85 },
});
