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
import {
  fetchAppointmentServices,
  type AppointmentServiceOption,
} from '@/services/appointment-booking';
import { ApiError } from '@/services/api-client';
import { isOfflineError } from '@/services/customer-profile';
import { fetchProviderProfile, type ProviderProfile } from '@/services/provider-profile';
import { isUuid } from '@/utils/uuid';

type DetailState =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'error'
  | 'unavailable'
  | 'invalid_provider'
  | 'invalid_location'
  | 'feature_disabled';

type AuthoritativeService = AppointmentServiceOption & {
  pricePaise?: number;
  currency?: string;
};

const SERVICE_PIN_PATTERN = /^[1-9][0-9]{5}$/;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function servicePriceLabel(service: AuthoritativeService): string {
  const pricePaise = Number.isSafeInteger(service.pricePaise)
    ? service.pricePaise as number
    : Math.round(service.price * 100);
  const amount = pricePaise / 100;
  const currency = service.currency ?? 'INR';
  const digits = pricePaise % 100 === 0 ? 0 : 2;
  return currency === 'INR'
    ? `₹${amount.toFixed(digits)}`
    : `${currency} ${amount.toFixed(digits)}`;
}

export default function GroomerDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity, selectedPincode, openLocationModal } = useLocation();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const providerId = single(params.id);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<AppointmentServiceOption[]>([]);
  const [state, setState] = useState<DetailState>('loading');
  const requestGeneration = useRef(0);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/grooming' as never);
  }, [router]);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setProvider(null);
    setServices([]);

    if (!activeCity.featureFlags.allowGrooming) {
      setState('feature_disabled');
      return;
    }
    if (!providerId || !isUuid(providerId)) {
      setState('invalid_provider');
      return;
    }
    if (!SERVICE_PIN_PATTERN.test(selectedPincode)) {
      setState('invalid_location');
      return;
    }

    setState('loading');
    try {
      // This public endpoint fails closed unless the outlet is ACTIVE, has the
      // GROOMING capability and serves the currently selected PIN.
      const profile = await fetchProviderProfile(providerId, { kind: 'groomer', pincode: selectedPincode });
      if (requestGeneration.current !== generation) return;
      if (!profile.capabilities.includes('GROOMING')) throw new Error('PROVIDER_CAPABILITY_MISMATCH');

      const published = await fetchAppointmentServices({ providerId, capability: 'GROOMING' });
      if (requestGeneration.current !== generation) return;
      if (published.some((service) => service.providerId !== providerId || service.capability !== 'GROOMING')) {
        throw new Error('SERVICE_PROVIDER_MISMATCH');
      }

      setProvider(profile);
      setServices([...published].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setProvider(null);
      setServices([]);
      if (isOfflineError(error)) {
        setState('offline');
      } else if (error instanceof ApiError && error.status === 404) {
        // The public API intentionally minimizes whether the outlet is missing,
        // inactive, wrong-capability or no longer serviceable for this PIN.
        setState('unavailable');
      } else {
        setState('error');
      }
    }
  }, [activeCity.featureFlags.allowGrooming, providerId, selectedPincode]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  const subtitle = useMemo(
    () => SERVICE_PIN_PATTERN.test(selectedPincode)
      ? `Published grooming services serving PIN ${selectedPincode}`
      : 'Choose a service PIN to verify this groomer',
    [selectedPincode],
  );

  const chooseService = useCallback((service: AppointmentServiceOption) => {
    if (!providerId || service.providerId !== providerId || service.capability !== 'GROOMING') return;
    router.push({
      pathname: '/groomer/[id]/slots',
      params: { id: providerId, serviceId: service.id },
    } as never);
  }, [providerId, router]);

  return (
    <ScreenShell
      header={(
        <ScreenHeader
          title={provider?.name ?? 'Groomer details'}
          subtitle={subtitle}
          onBack={goBack}
          backLabel="Back from groomer details"
        />
      )}
      contentContainerStyle={styles.content}
      testID="p10-groomer-detail-screen"
    >
      {state === 'loading' ? (
        <StateView
          kind="loading"
          title="Loading groomer"
          message="Verifying the current provider and published grooming services."
        />
      ) : null}

      {state === 'feature_disabled' ? (
        <StateView
          kind="empty"
          title={`Grooming is not available in ${activeCity.displayName}`}
          message="Choose another supported service city before opening groomer details."
          actionLabel="Change location"
          onAction={openLocationModal}
        />
      ) : null}

      {state === 'invalid_location' ? (
        <StateView
          kind="error"
          title="Select a service PIN"
          message="A valid active six-digit service PIN is required to verify groomer serviceability."
          actionLabel="Choose location"
          onAction={openLocationModal}
        />
      ) : null}

      {state === 'invalid_provider' ? (
        <StateView
          kind="error"
          title="Invalid groomer link"
          message="This groomer link does not contain a valid provider identifier."
          actionLabel="Back to groomers"
          onAction={goBack}
        />
      ) : null}

      {state === 'unavailable' ? (
        <StateView
          kind="empty"
          title="Groomer unavailable"
          message={`This groomer is not currently public, active, grooming-capable and serviceable for PIN ${selectedPincode}.`}
          actionLabel="Back to groomers"
          onAction={goBack}
        />
      ) : null}

      {state === 'offline' ? (
        <StateView
          kind="offline"
          title="You're offline"
          message="Reconnect to verify the current groomer and published services."
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}

      {state === 'error' ? (
        <StateView
          kind="error"
          title="Groomer details could not load"
          message="MyPet could not verify the current provider or service catalogue."
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}

      {state === 'ready' && provider ? (
        <>
          <View style={[styles.providerCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}>
              <AppIcon name="groom" color={theme.primary} size={30} />
            </View>
            <View style={styles.providerCopy}>
              <ThemedText style={[styles.providerName, { color: theme.text }]}>{provider.name}</ThemedText>
              <ThemedText style={[styles.authorityLine, { color: theme.textSecondary }]}>Grooming · Serves PIN {selectedPincode}</ThemedText>
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Published grooming services</ThemedText>
            <ThemedText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
              Price, duration and description below are read from this provider’s current public catalogue.
            </ThemedText>

            {services.length === 0 ? (
              <StateView
                kind="empty"
                title="No grooming services published"
                message="This groomer is currently serviceable, but has no active public grooming services to select."
                actionLabel="Refresh"
                onAction={() => void load()}
              />
            ) : (
              <View style={styles.serviceList}>
                {services.map((service) => {
                  const priceLabel = servicePriceLabel(service as AuthoritativeService);
                  return (
                    <Pressable
                      key={service.id}
                      onPress={() => chooseService(service)}
                      accessibilityRole="button"
                      accessibilityLabel={`${service.name}, ${service.durationMinutes} minutes, ${priceLabel}. Choose service.`}
                      accessibilityHint="Shows current available dates and appointment times"
                      style={({ pressed }) => [
                        styles.serviceCard,
                        shadows.card,
                        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.serviceCopy}>
                        <ThemedText style={[styles.serviceName, { color: theme.text }]}>{service.name}</ThemedText>
                        {service.description ? (
                          <ThemedText style={[styles.description, { color: theme.textSecondary }]}>{service.description}</ThemedText>
                        ) : null}
                        <ThemedText style={[styles.duration, { color: theme.textSecondary }]}>{service.durationMinutes} minutes</ThemedText>
                      </View>
                      <View style={styles.priceColumn}>
                        <ThemedText style={[styles.price, { color: theme.primary }]}>{priceLabel}</ThemedText>
                        <ThemedText style={[styles.chooseLabel, { color: theme.primary }]}>Choose →</ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
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
  providerCard: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    padding: spacing.x4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
  },
  iconWrap: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  providerName: { ...typography.headline, fontSize: 19, lineHeight: 26, fontWeight: '800', flexShrink: 1 },
  authorityLine: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  section: { gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 18, lineHeight: 25, fontWeight: '800' },
  sectionSubtitle: { fontSize: 13, lineHeight: 19 },
  serviceList: { gap: spacing.x3 },
  serviceCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x3,
    padding: spacing.x4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
  },
  serviceCopy: { flex: 1, minWidth: 0, gap: spacing.x2 },
  serviceName: { fontSize: 16, lineHeight: 23, fontWeight: '800', flexShrink: 1 },
  description: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  duration: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  priceColumn: { minWidth: 78, alignItems: 'flex-end', gap: spacing.x2 },
  price: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  chooseLabel: { minHeight: touchTarget, textAlignVertical: 'center', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
