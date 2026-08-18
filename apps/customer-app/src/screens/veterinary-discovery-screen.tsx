import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { INITIAL_MARKET } from '@/config/markets';
import { BottomTabInset } from '@/constants/theme';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isOfflineError } from '@/services/customer-profile';
import {
  fetchProviderPage,
  mergeUniqueProviders,
  PROVIDER_DISCOVERY_PAGE_SIZE,
  type ProviderSummary,
} from '@/services/provider-discovery';

type LoadState = 'loading' | 'ready' | 'offline' | 'error' | 'feature_disabled' | 'invalid_location';
type RefreshError = 'offline' | 'error' | null;

const SERVICE_PIN_PATTERN = /^[1-9][0-9]{5}$/;

export default function VeterinaryDiscoveryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity, selectedPincode, openLocationModal } = useLocation();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [hasNext, setHasNext] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<RefreshError>(null);
  const requestGeneration = useRef(0);
  const firstPageLoadingRef = useRef(false);
  const loadingMoreRef = useRef(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home' as never);
  }, [router]);

  const loadFirstPage = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    firstPageLoadingRef.current = true;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    setRefreshError(null);

    if (!activeCity.featureFlags.allowVet) {
      firstPageLoadingRef.current = false;
      setProviders([]);
      setHasNext(false);
      setNextPage(1);
      setRefreshing(false);
      setState('feature_disabled');
      return;
    }
    if (!SERVICE_PIN_PATTERN.test(selectedPincode)) {
      firstPageLoadingRef.current = false;
      setProviders([]);
      setHasNext(false);
      setNextPage(1);
      setRefreshing(false);
      setState('invalid_location');
      return;
    }

    if (mode === 'initial') {
      setProviders([]);
      setHasNext(false);
      setNextPage(1);
      setState('loading');
    } else setRefreshing(true);

    try {
      const response = await fetchProviderPage('VET_HOSPITAL', INITIAL_MARKET, selectedPincode, {
        page: 0,
        pageSize: PROVIDER_DISCOVERY_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setProviders(mergeUniqueProviders([], response.items));
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      const failure = isOfflineError(error) ? 'offline' : 'error';
      if (mode === 'refresh') {
        setRefreshError(failure);
        setState('ready');
      } else {
        setProviders([]);
        setHasNext(false);
        setNextPage(1);
        setState(failure);
      }
    } finally {
      if (requestGeneration.current === generation) {
        firstPageLoadingRef.current = false;
        setRefreshing(false);
      }
    }
  }, [activeCity.featureFlags.allowVet, selectedPincode]);

  useEffect(() => {
    void loadFirstPage('initial');
    return () => {
      requestGeneration.current += 1;
      firstPageLoadingRef.current = false;
      loadingMoreRef.current = false;
    };
  }, [loadFirstPage]);

  const loadNextPage = useCallback(async () => {
    if (state !== 'ready' || refreshing || firstPageLoadingRef.current || !hasNext || loadingMoreRef.current || !SERVICE_PIN_PATTERN.test(selectedPincode)) return;
    const generation = requestGeneration.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await fetchProviderPage('VET_HOSPITAL', INITIAL_MARKET, selectedPincode, {
        page: nextPage,
        pageSize: PROVIDER_DISCOVERY_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setProviders((current) => mergeUniqueProviders(current, response.items));
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setLoadMoreError(isOfflineError(error)
        ? 'Reconnect to load more veterinary providers serving this PIN.'
        : 'Could not load more veterinary providers serving this PIN.');
    } finally {
      if (requestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasNext, nextPage, refreshing, selectedPincode, state]);

  const openProvider = useCallback((providerId: string) => {
    router.push(`/vet/${encodeURIComponent(providerId)}` as never);
  }, [router]);

  const subtitle = SERVICE_PIN_PATTERN.test(selectedPincode)
    ? `Active veterinary providers serving PIN ${selectedPincode}`
    : 'Choose an active service PIN to discover veterinary care';

  return (
    <ScreenShell scroll={false} header={<ScreenHeader title="Veterinary care near you" subtitle={subtitle} onBack={goBack} backLabel="Back from veterinary discovery" />} contentContainerStyle={styles.shellContent} testID="veterinary-discovery-screen">
      {state === 'loading' ? <StateView kind="loading" title="Finding veterinary providers" message={`Checking active veterinary clinics and hospitals serving PIN ${selectedPincode}.`} /> : null}
      {state === 'feature_disabled' ? <StateView kind="empty" title={`Veterinary care is not available in ${activeCity.displayName}`} message="Choose another supported service city to discover veterinary providers." actionLabel="Change location" onAction={openLocationModal} /> : null}
      {state === 'invalid_location' ? <StateView kind="error" title="Select a service PIN" message="A valid active six-digit service PIN is required before MyPet can check veterinary serviceability." actionLabel="Choose location" onAction={openLocationModal} /> : null}
      {state === 'offline' ? <StateView kind="offline" title="You're offline" message="Reconnect to load current veterinary providers serving your selected PIN." actionLabel="Retry" onAction={() => void loadFirstPage('initial')} /> : null}
      {state === 'error' ? <StateView kind="error" title="Veterinary providers could not load" message="MyPet could not verify current veterinary providers for this service PIN." actionLabel="Retry" onAction={() => void loadFirstPage('initial')} /> : null}
      {state === 'ready' ? (
        <FlatList
          data={providers}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={providers.length === 0 ? styles.emptyListContent : styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFirstPage('refresh')} />}
          ListHeaderComponent={refreshError ? (
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={[styles.noticeTitle, { color: theme.text }]}>Refresh failed</ThemedText>
              <ThemedText style={[styles.noticeBody, { color: theme.textSecondary }]}>{refreshError === 'offline' ? 'Reconnect and retry. The previous verified list is still shown.' : 'Current provider data could not be refreshed. The previous verified list is still shown.'}</ThemedText>
              <PrimaryButton label="Retry refresh" variant="secondary" onPress={() => void loadFirstPage('refresh')} />
            </View>
          ) : null}
          ListEmptyComponent={<StateView kind="empty" title="No veterinary providers serve this PIN yet" message={`No active veterinary clinic or hospital currently serves PIN ${selectedPincode}.`} actionLabel="Change location" onAction={openLocationModal} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => openProvider(item.id)} accessibilityRole="button" accessibilityLabel={`${item.name}. ${item.description || 'Veterinary care'}. Serves PIN ${selectedPincode}. Open veterinary provider details.`} style={({ pressed }) => [styles.providerCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, pressed && styles.pressed]}>
              <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}><AppIcon name="medical" color={theme.primary} size={28} /></View>
              <View style={styles.providerCopy}>
                <ThemedText style={[styles.providerName, { color: theme.text }]}>{item.name}</ThemedText>
                <ThemedText style={[styles.description, { color: theme.textSecondary }]}>{item.description || 'Veterinary care'}</ThemedText>
                <ThemedText style={[styles.serviceability, { color: theme.primary }]}>Serves PIN {selectedPincode}</ThemedText>
              </View>
              <AppIcon name="chevron" color={theme.textSecondary} size={18} />
            </Pressable>
          )}
          ListFooterComponent={providers.length > 0 ? (
            <View style={styles.paginationFooter}>
              {loadMoreError ? <><ThemedText style={[styles.noticeBody, { color: theme.textSecondary }]}>{loadMoreError}</ThemedText><PrimaryButton label="Retry loading more" variant="secondary" onPress={() => void loadNextPage()} /></> : hasNext ? <PrimaryButton label="Load more veterinary providers" variant="secondary" loading={loadingMore} onPress={() => void loadNextPage()} /> : <ThemedText style={[styles.endLabel, { color: theme.textSecondary }]}>All serviceable veterinary providers loaded.</ThemedText>}
            </View>
          ) : null}
        />
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: { flex: 1, paddingHorizontal: spacing.x4, paddingTop: spacing.x3 },
  listContent: { gap: spacing.x3, paddingBottom: BottomTabInset + spacing.x8 },
  emptyListContent: { flexGrow: 1, paddingBottom: BottomTabInset + spacing.x8 },
  providerCard: { minHeight: 104, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  iconWrap: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  providerCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  providerName: { ...typography.headline, fontSize: 17, lineHeight: 23, fontWeight: '800', flexShrink: 1 },
  description: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  serviceability: { fontSize: 12, lineHeight: 18, fontWeight: '800' },
  notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x3, gap: spacing.x2, marginBottom: spacing.x3 },
  noticeTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  noticeBody: { fontSize: 12, lineHeight: 18 },
  paginationFooter: { gap: spacing.x2, paddingVertical: spacing.x3 },
  endLabel: { minHeight: touchTarget, textAlign: 'center', textAlignVertical: 'center', fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.82 },
});
