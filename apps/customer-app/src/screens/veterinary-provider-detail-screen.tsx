import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useLocation } from '@/context/LocationContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { fetchAppointmentServices, type AppointmentServiceOption } from '@/services/appointment-booking';
import { ApiError } from '@/services/api-client';
import { isOfflineError } from '@/services/customer-profile';
import { fetchProviderProfile, type ProviderProfile } from '@/services/provider-profile';

type DetailState = 'loading' | 'ready' | 'offline' | 'error' | 'unavailable' | 'invalid_provider' | 'invalid_location' | 'feature_disabled';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_PIN_PATTERN = /^[1-9][0-9]{5}$/;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function priceLabel(service: AppointmentServiceOption): string {
  const amount = service.pricePaise / 100;
  const digits = service.pricePaise % 100 === 0 ? 0 : 2;
  return service.currency === 'INR' ? `₹${amount.toFixed(digits)}` : `${service.currency} ${amount.toFixed(digits)}`;
}

export default function VeterinaryProviderDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity, selectedPincode, openLocationModal } = useLocation();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const providerId = single(params.slug);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<AppointmentServiceOption[]>([]);
  const [state, setState] = useState<DetailState>('loading');
  const requestGeneration = useRef(0);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/vet' as never);
  }, [router]);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setProvider(null);
    setServices([]);

    if (!activeCity.featureFlags.allowVet) {
      setState('feature_disabled');
      return;
    }
    if (!providerId || !UUID_PATTERN.test(providerId)) {
      setState('invalid_provider');
      return;
    }
    if (!SERVICE_PIN_PATTERN.test(selectedPincode)) {
      setState('invalid_location');
      return;
    }

    setState('loading');
    try {
      const profile = await fetchProviderProfile(providerId, { kind: 'vet', pincode: selectedPincode });
      if (requestGeneration.current !== generation) return;
      if (!profile.capabilities.some((capability) => capability === 'VETERINARY_CLINIC' || capability === 'VETERINARY_HOSPITAL')) throw new Error('PROVIDER_CAPABILITY_MISMATCH');
      const published = await fetchAppointmentServices({ providerId, capability: 'VETERINARY' });
      if (requestGeneration.current !== generation) return;
      if (published.some((service) => service.providerId !== providerId || service.capability !== 'VETERINARY')) throw new Error('SERVICE_PROVIDER_MISMATCH');
      setProvider(profile);
      setServices([...published].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setProvider(null);
      setServices([]);
      if (isOfflineError(error)) setState('offline');
      else if (error instanceof ApiError && error.status === 404) setState('unavailable');
      else setState('error');
    }
  }, [activeCity.featureFlags.allowVet, providerId, selectedPincode]);

  useEffect(() => {
    void load();
    return () => { requestGeneration.current += 1; };
  }, [load]);

  const subtitle = useMemo(
    () => SERVICE_PIN_PATTERN.test(selectedPincode) ? `Published veterinary services serving PIN ${selectedPincode}` : 'Choose a service PIN to verify this provider',
    [selectedPincode],
  );

  const chooseService = useCallback((service: AppointmentServiceOption) => {
    if (!providerId || service.providerId !== providerId || service.capability !== 'VETERINARY') return;
    router.push({ pathname: '/vet/[slug]/slots', params: { slug: providerId, serviceId: service.id } } as never);
  }, [providerId, router]);

  return (
    <ScreenShell header={<ScreenHeader title={provider?.name ?? 'Veterinary provider'} subtitle={subtitle} onBack={goBack} backLabel="Back from veterinary provider details" />} contentContainerStyle={styles.content} testID="p11-veterinary-provider-detail-screen">
      {state === 'loading' ? <StateView kind="loading" title="Loading veterinary provider" message="Verifying the current provider and published veterinary services." /> : null}
      {state === 'feature_disabled' ? <StateView kind="empty" title={`Veterinary care is not available in ${activeCity.displayName}`} message="Choose another supported service city before opening provider details." actionLabel="Change location" onAction={openLocationModal} /> : null}
      {state === 'invalid_location' ? <StateView kind="error" title="Select a service PIN" message="A valid active six-digit service PIN is required to verify veterinary serviceability." actionLabel="Choose location" onAction={openLocationModal} /> : null}
      {state === 'invalid_provider' ? <StateView kind="error" title="Invalid veterinary provider link" message="This link does not contain a valid provider identifier." actionLabel="Back to veterinary care" onAction={goBack} /> : null}
      {state === 'unavailable' ? <StateView kind="empty" title="Veterinary provider unavailable" message={`This provider is not currently public, active, veterinary-capable and serviceable for PIN ${selectedPincode}.`} actionLabel="Back to veterinary care" onAction={goBack} /> : null}
      {state === 'offline' ? <StateView kind="offline" title="You're offline" message="Reconnect to verify this provider and its published services." actionLabel="Retry" onAction={() => void load()} /> : null}
      {state === 'error' ? <StateView kind="error" title="Veterinary provider could not load" message="MyPet could not verify the current provider or service catalogue." actionLabel="Retry" onAction={() => void load()} /> : null}

      {state === 'ready' && provider ? (
        <>
          <View style={[styles.providerCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}><AppIcon name="medical" color={theme.primary} size={30} /></View>
            <View style={styles.providerCopy}>
              <ThemedText style={[styles.providerName, { color: theme.text }]}>{provider.name}</ThemedText>
              <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>Veterinary care · Serves PIN {selectedPincode}</ThemedText>
            </View>
          </View>
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Published veterinary services</ThemedText>
            <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>Price, duration and description are read from the current public catalogue for this provider.</ThemedText>
            {services.length === 0 ? <StateView kind="empty" title="No veterinary services published" message="This provider is currently serviceable but has no active public veterinary services to select." actionLabel="Refresh" onAction={() => void load()} /> : (
              <View style={styles.serviceList}>
                {services.map((service) => (
                  <Pressable key={service.id} onPress={() => chooseService(service)} accessibilityRole="button" accessibilityLabel={`${service.name}, ${service.durationMinutes} minutes, ${priceLabel(service)}. Choose service.`} accessibilityHint="Shows current available veterinary dates and times" style={({ pressed }) => [styles.serviceCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, pressed && styles.pressed]}>
                    <View style={styles.serviceCopy}>
                      <ThemedText style={[styles.serviceName, { color: theme.text }]}>{service.name}</ThemedText>
                      {service.description ? <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>{service.description}</ThemedText> : null}
                      <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>{service.durationMinutes} minutes</ThemedText>
                    </View>
                    <View style={styles.priceColumn}>
                      <ThemedText style={[styles.price, { color: theme.primary }]}>{priceLabel(service)}</ThemedText>
                      <ThemedText style={[styles.chooseLabel, { color: theme.primary }]}>Choose →</ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          <PrimaryButton label="Refresh current services" variant="secondary" onPress={() => void load()} />
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.x4, paddingBottom: spacing.x8 },
  providerCard: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.x3, padding: spacing.x4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card },
  iconWrap: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
  providerCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  providerName: { ...typography.headline, fontSize: 19, lineHeight: 26, fontWeight: '800', flexShrink: 1 },
  meta: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  section: { gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 18, lineHeight: 25, fontWeight: '800' },
  serviceList: { gap: spacing.x3 },
  serviceCard: { minHeight: 112, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3, padding: spacing.x4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card },
  serviceCopy: { flex: 1, minWidth: 0, gap: spacing.x2 },
  serviceName: { fontSize: 16, lineHeight: 23, fontWeight: '800', flexShrink: 1 },
  priceColumn: { minWidth: 78, alignItems: 'flex-end', gap: spacing.x2 },
  price: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  chooseLabel: { minHeight: touchTarget, textAlignVertical: 'center', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
