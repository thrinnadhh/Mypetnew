import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { FilterChip, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { INITIAL_MARKET } from '@/config/markets';
import { BottomTabInset } from '@/constants/theme';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchAppointmentServices,
  type AppointmentServiceOption,
} from '@/services/appointment-booking';
import { isOfflineError } from '@/services/customer-profile';
import { fetchProviders } from '@/services/provider-discovery';

type DurationFilter = 'ALL' | 'QUICK' | 'STANDARD' | 'EXTENDED';
type LoadState = 'loading' | 'ready' | 'offline' | 'error';

const FILTERS: ReadonlyArray<{ id: DurationFilter; label: string }> = [
  { id: 'ALL', label: 'All Services' },
  { id: 'QUICK', label: 'Quick Care' },
  { id: 'STANDARD', label: '30–60 mins' },
  { id: 'EXTENDED', label: '60+ mins' },
];

function matchesDuration(service: AppointmentServiceOption, filter: DurationFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'QUICK') return service.durationMinutes < 30;
  if (filter === 'STANDARD') return service.durationMinutes >= 30 && service.durationMinutes <= 60;
  return service.durationMinutes > 60;
}

export default function GroomingServicesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity } = useLocation();
  const [filterCategory, setFilterCategory] = useState<DurationFilter>('ALL');
  const [services, setServices] = useState<AppointmentServiceOption[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    if (!activeCity.featureFlags.allowGrooming) {
      setServices([]);
      setState('ready');
      return;
    }

    try {
      const providers = await fetchProviders('GROOMER', INITIAL_MARKET, activeCity.pincodes);
      const groups = await Promise.all(
        providers.map((provider) => fetchAppointmentServices({
          providerId: provider.id,
          capability: 'GROOMING',
        })),
      );
      const unique = new Map<string, AppointmentServiceOption>();
      for (const service of groups.flat()) unique.set(service.id, service);
      setServices([...unique.values()].sort((left, right) => left.name.localeCompare(right.name)));
      setState('ready');
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [activeCity.featureFlags.allowGrooming, activeCity.pincodes]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredServices = useMemo(
    () => services.filter((service) => matchesDuration(service, filterCategory)),
    [filterCategory, services],
  );

  return (
    <ScreenShell
      scroll={false}
      header={(
        <ScreenHeader
          title="Grooming Services & Spa"
          subtitle={`Live services in ${activeCity.displayName}`}
        />
      )}
      contentContainerStyle={styles.shellContent}
      testID="grooming-services-screen"
    >
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTERS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.filterList}
        style={styles.filterRow}
        renderItem={({ item }) => (
          <FilterChip
            label={item.label}
            selected={filterCategory === item.id}
            onPress={() => setFilterCategory(item.id)}
          />
        )}
      />

      {state === 'loading' ? (
        <StateView kind="loading" title="Loading grooming services" message="Checking live provider availability." />
      ) : null}
      {state === 'offline' ? (
        <StateView
          kind="offline"
          title="You're offline"
          message="Reconnect to load current grooming services and prices."
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}
      {state === 'error' ? (
        <StateView
          kind="error"
          title="Grooming services unavailable"
          message="We couldn't load the current service catalogue."
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}
      {state === 'ready' && !activeCity.featureFlags.allowGrooming ? (
        <StateView
          kind="empty"
          title={`Grooming is not enabled in ${activeCity.displayName}`}
          message="Choose another service city to see bookable grooming services."
        />
      ) : null}
      {state === 'ready' && activeCity.featureFlags.allowGrooming && services.length === 0 ? (
        <StateView
          kind="empty"
          title="No serviceable grooming services yet"
          message={`Groomers serving the selected ${activeCity.displayName} PIN codes have not published bookable services yet.`}
        />
      ) : null}
      {state === 'ready' && services.length > 0 && filteredServices.length === 0 ? (
        <StateView
          kind="empty"
          title="No services in this duration"
          message="Choose another filter to see currently published grooming services."
          actionLabel="Show all"
          onAction={() => setFilterCategory('ALL')}
        />
      ) : null}

      {state === 'ready' && filteredServices.length > 0 ? (
        <FlatList
          style={styles.serviceList}
          data={filteredServices}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View
              style={[
                styles.serviceCard,
                shadows.raised,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardCopy}>
                  <StatusBadge label={`⏱ ${item.durationMinutes} mins`} color={theme.primary} />
                  <ThemedText style={[styles.serviceTitle, { color: theme.text }]}>{item.name}</ThemedText>
                  <ThemedText numberOfLines={3} style={[styles.description, { color: theme.textSecondary }]}>
                    {item.description || 'Published by an active MyPet grooming provider.'}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.price, { color: theme.primary }]}>₹{item.price.toFixed(0)}</ThemedText>
              </View>

              <View style={styles.inclusionGrid}>
                <StatusBadge label="✓ Live price" color={theme.success} />
                <StatusBadge label="✓ Live slots" color={theme.success} />
                <StatusBadge label="✓ Pay at provider" color={theme.success} />
              </View>

              <PrimaryButton
                label="Choose live slot & pay"
                onPress={() => router.push(`/groom?providerId=${encodeURIComponent(item.providerId)}&serviceId=${encodeURIComponent(item.id)}` as never)}
              />
            </View>
          )}
        />
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: { paddingHorizontal: spacing.x4, paddingTop: spacing.x3, gap: spacing.x3 },
  filterRow: { flexGrow: 0, minHeight: 44 },
  filterList: { gap: spacing.x2, paddingRight: spacing.x6 },
  serviceList: { flex: 1 },
  listContent: { gap: spacing.x4, paddingBottom: BottomTabInset + spacing.x8 },
  serviceCard: { padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, gap: spacing.x3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.x3 },
  cardCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  serviceTitle: { ...typography.headline, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  description: { fontSize: 13, lineHeight: 19 },
  price: { ...typography.headline, fontSize: 20, fontWeight: '900' },
  inclusionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
});
