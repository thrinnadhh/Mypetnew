import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchAppointmentServices,
  type AppointmentServiceCapability,
  type AppointmentServiceOption,
} from '@/services/appointment-booking';
import { isOfflineError } from '@/services/customer-profile';
import { fetchProviderProfile, type ProviderProfile } from '@/services/provider-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';
type CareKind = 'groomer' | 'vet';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function LiveCareProviderDetailScreen({ kind }: { kind: CareKind }) {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity } = useLocation();
  const params = useLocalSearchParams<{ id?: string | string[]; slug?: string | string[] }>();
  const providerId = single(params.id) ?? single(params.slug);
  const capability: AppointmentServiceCapability = kind === 'groomer' ? 'GROOMING' : 'VETERINARY';
  const bookingRoute = kind === 'groomer' ? '/groom' : '/vet';
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<AppointmentServiceOption[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    if (!providerId) {
      setState('error');
      return;
    }
    setState('loading');
    try {
      const [profile, publishedServices] = await Promise.all([
        fetchProviderProfile(providerId),
        fetchAppointmentServices({ providerId, capability }),
      ]);
      setProvider(profile);
      setServices(publishedServices.sort((left, right) => left.name.localeCompare(right.name)));
      setState('ready');
    } catch (error) {
      setProvider(null);
      setServices([]);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [capability, providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const careLabel = kind === 'groomer' ? 'Grooming' : 'Veterinary';
  const iconName = kind === 'groomer' ? 'groom' : 'medical';
  const subtitle = useMemo(
    () => `Admin-approved ${careLabel.toLowerCase()} provider in ${activeCity.displayName}`,
    [activeCity.displayName, careLabel],
  );

  const openBooking = (serviceId?: string) => {
    if (!providerId) return;
    router.push({
      pathname: bookingRoute,
      params: serviceId ? { providerId, serviceId } : { providerId },
    } as never);
  };

  return (
    <ScreenShell
      header={<ScreenHeader title={provider?.name ?? `${careLabel} provider`} subtitle={subtitle} />}
      footer={state === 'ready' && provider && services.length > 0 ? (
        <View style={[styles.footer, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <PrimaryButton
            label={kind === 'groomer' ? 'Choose grooming slot' : 'Choose appointment slot'}
            onPress={() => openBooking()}
          />
        </View>
      ) : undefined}
      contentContainerStyle={styles.content}
      testID={`${kind}-live-provider-detail`}
    >
      {state === 'loading' ? (
        <StateView kind="loading" title={`Loading ${careLabel.toLowerCase()} provider`} message="Checking the live provider profile and published services." />
      ) : null}

      {state === 'offline' || state === 'error' ? (
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : `${careLabel} provider unavailable`}
          message={state === 'offline'
            ? 'Reconnect to load the current provider and services.'
            : 'This provider is not currently available to customers.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}

      {state === 'ready' && provider ? (
        <>
          <View style={[styles.providerCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}>
              <AppIcon name={iconName} color={theme.primary} size={30} />
            </View>
            <View style={styles.providerCopy}>
              <View style={styles.titleRow}>
                <ThemedText style={[styles.providerName, { color: theme.text }]} numberOfLines={2}>
                  {provider.name}
                </ThemedText>
                <StatusBadge label="Approved" color={theme.success} />
              </View>
              <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
                {provider.description || `${careLabel} services from an active MyPet provider.`}
              </ThemedText>
              <View style={styles.badgeRow}>
                <StatusBadge label={activeCity.displayName} color={theme.primary} />
                <StatusBadge label="Live booking" color={theme.success} />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Published services</ThemedText>
            <ThemedText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
              Prices and services below come from the current merchant catalogue for this provider.
            </ThemedText>

            {services.length === 0 ? (
              <StateView
                kind="empty"
                title="No services published yet"
                message={`The approved ${careLabel.toLowerCase()} provider is visible, but the merchant has not published bookable services yet.`}
              />
            ) : (
              <View style={styles.serviceList}>
                {services.map((service) => (
                  <Pressable
                    key={service.id}
                    onPress={() => openBooking(service.id)}
                    style={({ pressed }) => [
                      styles.serviceCard,
                      shadows.raised,
                      { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Book ${service.name}`}
                  >
                    <View style={styles.serviceCopy}>
                      <ThemedText style={[styles.serviceName, { color: theme.text }]}>{service.name}</ThemedText>
                      <ThemedText style={[styles.description, { color: theme.textSecondary }]} numberOfLines={3}>
                        {service.description || 'Published by this provider.'}
                      </ThemedText>
                      <StatusBadge label={`⏱ ${service.durationMinutes} mins`} color={theme.primary} />
                    </View>
                    <View style={styles.priceColumn}>
                      <ThemedText style={[styles.price, { color: theme.primary }]}>₹{service.price.toFixed(0)}</ThemedText>
                      <ThemedText style={[styles.bookLabel, { color: theme.primary }]}>Slots →</ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={[styles.lifecycleNote, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}>
            <AppIcon name="document" color={theme.primary} size={19} />
            <View style={styles.lifecycleCopy}>
              <ThemedText style={[styles.lifecycleTitle, { color: theme.text }]}>Live marketplace profile</ThemedText>
              <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
                Provider visibility follows admin approval. Merchant service updates are read from the backend and do not require a customer-app release.
              </ThemedText>
            </View>
          </View>
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.x4, paddingBottom: spacing.x8 },
  providerCard: { flexDirection: 'row', gap: spacing.x3, padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  iconWrap: { width: 68, height: 68, borderRadius: radii.card, alignItems: 'center', justifyContent: 'center' },
  providerCopy: { flex: 1, minWidth: 0, gap: spacing.x2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x2 },
  providerName: { ...typography.headline, flex: 1, fontSize: 19, lineHeight: 25, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 19 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  section: { gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  sectionSubtitle: { fontSize: 12, lineHeight: 18 },
  serviceList: { gap: spacing.x3 },
  serviceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3, padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  serviceCopy: { flex: 1, minWidth: 0, gap: spacing.x2, alignItems: 'flex-start' },
  serviceName: { fontSize: 15, lineHeight: 21, fontWeight: '800' },
  priceColumn: { alignItems: 'flex-end', gap: spacing.x2 },
  price: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  bookLabel: { fontSize: 12, fontWeight: '800' },
  lifecycleNote: { flexDirection: 'row', gap: spacing.x3, padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  lifecycleCopy: { flex: 1, gap: spacing.x1 },
  lifecycleTitle: { fontSize: 14, fontWeight: '800' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.x4, paddingTop: spacing.x3, paddingBottom: spacing.x4 },
  pressed: { opacity: 0.86 },
});
