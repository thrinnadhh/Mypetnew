import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isOfflineError } from '@/services/customer-profile';
import { appConfig } from '@/utils/app-config';

export interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  rating?: string;
  price?: string;
  distanceKm?: number;
  route: string;
  isEmergency?: boolean;
}

const RECENT_SEARCHES_KEY = 'mypet_recent_searches_v1';
const FILTER_TYPES = [
  { id: 'ALL', label: 'All' },
  { id: 'PRODUCT', label: 'Products' },
  { id: 'PET_SHOP', label: 'Shops' },
  { id: 'HOSPITAL', label: 'Hospitals' },
  { id: 'GROOMER', label: 'Grooming' },
  { id: 'GUIDE', label: 'Guides' },
];

type SearchState = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

export default function UniversalSearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  const { activeCity } = useLocation();

  const [query, setQuery] = useState(params.q ?? '');
  const [selectedType, setSelectedType] = useState('ALL');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [state, setState] = useState<SearchState>(params.q ? 'loading' : 'idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const performSearch = useCallback(async (searchQuery: string, type: string) => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      setResults([]);
      setState('idle');
      setErrorMessage(null);
      return;
    }

    setState('loading');
    setErrorMessage(null);
    try {
      const searchParams = new URLSearchParams({
        q: normalizedQuery,
        city: activeCity.cityIdentity,
      });
      if (type !== 'ALL') searchParams.set('type', type);

      const response = await fetch(
        `${appConfig.apiBaseUrl}/api/v1/discovery/search?${searchParams.toString()}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(body?.message || body?.error || `Search failed (${response.status})`);
      }

      const data = (await response.json()) as { results?: SearchResultItem[] } | SearchResultItem[];
      const nextResults = Array.isArray(data) ? data : data.results ?? [];
      setResults(nextResults);
      setState('ready');
      await saveRecentSearch(normalizedQuery);
    } catch (error) {
      setResults([]);
      setErrorMessage(error instanceof Error ? error.message : 'Search is unavailable.');
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [activeCity.cityIdentity, saveRecentSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void performSearch(query, selectedType);
    }, 300);
    return () => clearTimeout(timer);
  }, [performSearch, query, selectedType]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.navHeader, { borderColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <AppIcon name="close" color={theme.text} size={20} />
        </Pressable>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <AppIcon name="search" color={theme.textSecondary} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search food, clinics, grooming, guides..."
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            autoFocus={!params.q}
            returnKeyType="search"
            accessibilityLabel="Search MyPet"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} style={styles.iconBtn} accessibilityLabel="Clear search">
              <AppIcon name="close" color={theme.textSecondary} size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTER_TYPES}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <FilterChip
              label={item.label}
              selected={selectedType === item.id}
              onPress={() => setSelectedType(item.id)}
            />
          )}
        />
      </View>

      {state === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={{ color: theme.textSecondary, marginTop: 8 }}>Searching active providers...</ThemedText>
        </View>
      ) : state === 'offline' || state === 'error' ? (
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Search unavailable'}
          message={errorMessage ?? 'Could not search MyPet right now.'}
          actionLabel="Retry"
          onAction={() => void performSearch(query, selectedType)}
        />
      ) : query.trim().length === 0 ? (
        <View style={styles.recentSection}>
          {recentSearches.length > 0 ? (
            <>
              <View style={styles.recentHeader}>
                <ThemedText style={styles.recentTitle}>Recent Searches</ThemedText>
                <Pressable onPress={() => void clearRecentSearches()}>
                  <ThemedText style={{ color: theme.primary, fontSize: 13, fontWeight: '700' }}>Clear All</ThemedText>
                </Pressable>
              </View>
              <View style={styles.chipGrid}>
                {recentSearches.map((term) => (
                  <Pressable
                    key={term}
                    onPress={() => setQuery(term)}
                    style={[styles.recentChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  >
                    <AppIcon name="history" color={theme.textSecondary} size={14} />
                    <ThemedText style={{ fontSize: 13, color: theme.text }}>{term}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <ThemedText style={[styles.recentTitle, { marginTop: spacing.x6 }]}>Popular Categories</ThemedText>
          <View style={styles.chipGrid}>
            {['Maxi Puppy Food', '24/7 Vet ICU', 'Full Grooming Bath', 'Puppy Teething Guide'].map((term) => (
              <Pressable
                key={term}
                onPress={() => setQuery(term)}
                style={[styles.recentChip, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}
              >
                <AppIcon name="sparkle" color={theme.primary} size={14} />
                <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: '600' }}>{term}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <AppIcon name="search" color={theme.textSecondary} size={40} />
          <ThemedText style={{ fontWeight: '700', fontSize: 16, marginTop: 12 }}>No matching results</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4 }}>
            Try searching for food, vet hospitals, grooming spas, or guides in {activeCity.displayName}.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          contentContainerStyle={styles.resultsList}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(item.route as never)}
              style={({ pressed }) => [
                styles.resultCard,
                shadows.raised,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.resultTypeBadge}>
                <StatusBadge label={item.type.replace('_', ' ')} color={theme.primary} />
                {item.isEmergency ? <StatusBadge label="24/7 ICU" color={theme.danger} /> : null}
              </View>
              <ThemedText style={[styles.resultTitle, { color: theme.text }]}>{item.title}</ThemedText>
              {item.subtitle ? <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>{item.subtitle}</ThemedText> : null}
              <View style={styles.resultFooter}>
                {item.price ? <ThemedText style={{ fontWeight: '700', color: theme.primary }}>{item.price}</ThemedText> : null}
                {item.distanceKm != null ? (
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                    {item.distanceKm.toFixed(1)} km away
                  </ThemedText>
                ) : null}
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
  navHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3, paddingHorizontal: spacing.x4, paddingTop: spacing.x6, paddingBottom: spacing.x3, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.x2, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x3, height: 44 },
  searchInput: { flex: 1, height: 44, ...typography.body },
  iconBtn: { padding: 4 },
  filterRow: { paddingVertical: spacing.x2 },
  filterList: { gap: spacing.x2, paddingHorizontal: spacing.x4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.x6 },
  recentSection: { padding: spacing.x4, gap: spacing.x3 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recentTitle: { ...typography.label, fontSize: 13, color: '#888888', textTransform: 'uppercase' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  recentChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingHorizontal: spacing.x3, paddingVertical: spacing.x2, borderRadius: radii.compact, borderWidth: 1 },
  resultsList: { padding: spacing.x4, gap: spacing.x3 },
  resultCard: { padding: spacing.x4, borderRadius: radii.card, borderWidth: 1, gap: spacing.x2 },
  resultTypeBadge: { flexDirection: 'row', gap: spacing.x2, alignItems: 'center' },
  resultTitle: { ...typography.headline, fontSize: 16 },
  resultFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  pressed: { opacity: 0.85 },
});
