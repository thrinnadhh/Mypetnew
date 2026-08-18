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
  APPOINTMENT_DISPLAY_TIME_ZONE,
  fetchAppointmentServices,
  fetchAvailableAppointmentSlots,
  type AppointmentServiceOption,
  type AppointmentSlotOption,
} from '@/services/appointment-booking';
import { ApiError } from '@/services/api-client';
import { isOfflineError } from '@/services/customer-profile';
import { fetchProviderProfile, type ProviderProfile } from '@/services/provider-profile';

type SlotState =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'error'
  | 'unavailable'
  | 'service_unavailable'
  | 'invalid_provider'
  | 'invalid_service'
  | 'invalid_location'
  | 'feature_disabled';

type RefreshFailure = 'offline' | 'error' | null;
type FreshnessFailure = 'offline' | 'error' | null;
type AuthoritativeService = AppointmentServiceOption & { pricePaise?: number; currency?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_PIN_PATTERN = /^[1-9][0-9]{5}$/;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dateParts(instant: string): { year: string; month: string; day: string } | null {
  const value = new Date(instant);
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APPOINTMENT_DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? { year, month, day } : null;
}

function dateKey(instant: string | undefined): string | null {
  if (!instant) return null;
  const parts = dateParts(instant);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

function dateLabel(instant: string): string {
  return new Date(instant).toLocaleDateString('en-IN', {
    timeZone: APPOINTMENT_DISPLAY_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function timeLabel(instant: string): string {
  return new Date(instant).toLocaleTimeString('en-IN', {
    timeZone: APPOINTMENT_DISPLAY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function servicePriceLabel(service: AuthoritativeService): string {
  const paise = Number.isSafeInteger(service.pricePaise)
    ? service.pricePaise as number
    : Math.round(service.price * 100);
  const amount = paise / 100;
  const currency = service.currency ?? 'INR';
  const digits = paise % 100 === 0 ? 0 : 2;
  return currency === 'INR' ? `₹${amount.toFixed(digits)}` : `${currency} ${amount.toFixed(digits)}`;
}

function sameCanonicalSlot(left: AppointmentSlotOption, right: AppointmentSlotOption): boolean {
  return left.id === right.id
    && left.providerId === right.providerId
    && left.offeringId === right.offeringId
    && left.startsAt === right.startsAt
    && left.endsAt === right.endsAt;
}

export default function GroomerSlotDiscoveryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity, selectedPincode, openLocationModal } = useLocation();
  const params = useLocalSearchParams<{
    id?: string | string[];
    serviceId?: string | string[];
  }>();
  const providerId = single(params.id);
  const serviceId = single(params.serviceId);

  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [service, setService] = useState<AppointmentServiceOption | null>(null);
  const [slots, setSlots] = useState<AppointmentSlotOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AppointmentSlotOption | null>(null);
  const [state, setState] = useState<SlotState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<RefreshFailure>(null);
  const [slotStale, setSlotStale] = useState(false);
  const [freshnessFailure, setFreshnessFailure] = useState<FreshnessFailure>(null);
  const [checkingFreshness, setCheckingFreshness] = useState(false);
  const requestGeneration = useRef(0);
  const handoffGeneration = useRef(0);
  const handoffInFlight = useRef(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (providerId) {
      router.replace(`/groomer/${encodeURIComponent(providerId)}` as never);
      return;
    }
    router.replace('/grooming' as never);
  }, [providerId, router]);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    handoffGeneration.current += 1;
    handoffInFlight.current = false;
    setCheckingFreshness(false);
    setFreshnessFailure(null);
    setRefreshFailure(null);

    if (!activeCity.featureFlags.allowGrooming) {
      setProvider(null);
      setService(null);
      setSlots([]);
      setSelectedDate(null);
      setSelectedSlot(null);
      setRefreshing(false);
      setState('feature_disabled');
      return;
    }
    if (!providerId || !UUID_PATTERN.test(providerId)) {
      setProvider(null);
      setService(null);
      setSlots([]);
      setSelectedDate(null);
      setSelectedSlot(null);
      setRefreshing(false);
      setState('invalid_provider');
      return;
    }
    if (!serviceId || !UUID_PATTERN.test(serviceId)) {
      setProvider(null);
      setService(null);
      setSlots([]);
      setSelectedDate(null);
      setSelectedSlot(null);
      setRefreshing(false);
      setState('invalid_service');
      return;
    }
    if (!SERVICE_PIN_PATTERN.test(selectedPincode)) {
      setProvider(null);
      setService(null);
      setSlots([]);
      setSelectedDate(null);
      setSelectedSlot(null);
      setRefreshing(false);
      setState('invalid_location');
      return;
    }

    if (mode === 'initial') {
      setProvider(null);
      setService(null);
      setSlots([]);
      setSelectedDate(null);
      setSelectedSlot(null);
      setSlotStale(false);
      setState('loading');
    } else {
      setRefreshing(true);
    }

    try {
      const currentProvider = await fetchProviderProfile(providerId, { kind: 'groomer', pincode: selectedPincode });
      if (requestGeneration.current !== generation) return;

      const publishedServices = await fetchAppointmentServices({ providerId, capability: 'GROOMING' });
      if (requestGeneration.current !== generation) return;
      const currentService = publishedServices.find((item) => item.id === serviceId);
      if (!currentService || currentService.providerId !== providerId || currentService.capability !== 'GROOMING') {
        setProvider(currentProvider);
        setService(null);
        setSlots([]);
        setSelectedDate(null);
        setSelectedSlot(null);
        setState('service_unavailable');
        return;
      }

      const currentSlots = await fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING');
      if (requestGeneration.current !== generation) return;
      if (currentSlots.some((slot) => slot.providerId !== providerId || slot.offeringId !== serviceId)) {
        throw new Error('SLOT_CONTEXT_MISMATCH');
      }

      const availableDateKeys = [...new Set(currentSlots.map((slot) => dateKey(slot.startsAt)).filter(Boolean) as string[])];
      setProvider(currentProvider);
      setService(currentService);
      setSlots(currentSlots);
      setSelectedDate((current) => current && availableDateKeys.includes(current) ? current : availableDateKeys[0] ?? null);
      setSelectedSlot((current) => {
        if (!current) return null;
        const refreshed = currentSlots.find((slot) => slot.id === current.id);
        if (!refreshed || !sameCanonicalSlot(current, refreshed)) {
          setSlotStale(true);
          return null;
        }
        return refreshed;
      });
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      const offline = isOfflineError(error);
      if (mode === 'refresh' && provider && service) {
        setRefreshFailure(offline ? 'offline' : 'error');
        setState('ready');
      } else if (offline) {
        setProvider(null);
        setService(null);
        setSlots([]);
        setSelectedDate(null);
        setSelectedSlot(null);
        setState('offline');
      } else if ((error instanceof ApiError && error.status === 404) || (error instanceof Error && error.name === 'RESOURCE_NOT_FOUND')) {
        setProvider(null);
        setService(null);
        setSlots([]);
        setSelectedDate(null);
        setSelectedSlot(null);
        setState('unavailable');
      } else if (error instanceof Error && error.name === 'SERVICE_NOT_AVAILABLE') {
        setService(null);
        setSlots([]);
        setSelectedDate(null);
        setSelectedSlot(null);
        setState('service_unavailable');
      } else {
        setProvider(null);
        setService(null);
        setSlots([]);
        setSelectedDate(null);
        setSelectedSlot(null);
        setState('error');
      }
    } finally {
      if (requestGeneration.current === generation) setRefreshing(false);
    }
  }, [activeCity.featureFlags.allowGrooming, provider, providerId, selectedPincode, service, serviceId]);

  useEffect(() => {
    void load('initial');
    return () => {
      requestGeneration.current += 1;
      handoffGeneration.current += 1;
      handoffInFlight.current = false;
    };
    // provider/service objects are intentionally excluded: they are outputs of load,
    // not inputs that should recursively trigger another availability request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCity.featureFlags.allowGrooming, providerId, selectedPincode, serviceId]);

  const dates = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const slot of slots) {
      if (!slot.startsAt) continue;
      const key = dateKey(slot.startsAt);
      if (key && !byKey.has(key)) byKey.set(key, slot.startsAt);
    }
    return [...byKey.entries()].map(([key, instant]) => ({ key, label: dateLabel(instant) }));
  }, [slots]);

  const visibleSlots = useMemo(
    () => slots.filter((slot) => dateKey(slot.startsAt) === selectedDate),
    [selectedDate, slots],
  );

  const chooseDate = useCallback((key: string) => {
    setSelectedDate(key);
    setSelectedSlot(null);
    setSlotStale(false);
    setFreshnessFailure(null);
  }, []);

  const chooseSlot = useCallback((slot: AppointmentSlotOption) => {
    if (slot.providerId !== providerId || slot.offeringId !== serviceId || !slot.startsAt || !slot.endsAt) return;
    setSelectedSlot(slot);
    setSlotStale(false);
    setFreshnessFailure(null);
  }, [providerId, serviceId]);

  const continueToBooking = useCallback(async () => {
    if (
      !providerId
      || !serviceId
      || !selectedSlot
      || !selectedSlot.startsAt
      || !selectedSlot.endsAt
      || handoffInFlight.current
      || !SERVICE_PIN_PATTERN.test(selectedPincode)
    ) return;

    handoffInFlight.current = true;
    setCheckingFreshness(true);
    setFreshnessFailure(null);
    const generation = handoffGeneration.current + 1;
    handoffGeneration.current = generation;
    const chosen = selectedSlot;

    try {
      await fetchProviderProfile(providerId, { kind: 'groomer', pincode: selectedPincode });
      if (handoffGeneration.current !== generation) return;
      const latest = await fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING');
      if (handoffGeneration.current !== generation) return;
      const current = latest.find((slot) => slot.id === chosen.id);
      if (!current || !sameCanonicalSlot(chosen, current)) {
        setSlots(latest);
        setSelectedSlot(null);
        setSelectedDate((date) => date && latest.some((slot) => dateKey(slot.startsAt) === date)
          ? date
          : dateKey(latest[0]?.startsAt) ?? null);
        setSlotStale(true);
        return;
      }

      router.push({
        pathname: '/groom',
        params: {
          providerId,
          serviceId,
          slotId: current.id,
          slotStartsAt: current.startsAt,
          slotEndsAt: current.endsAt,
          pincode: selectedPincode,
        },
      } as never);
    } catch (error) {
      if (handoffGeneration.current !== generation) return;
      setFreshnessFailure(isOfflineError(error) ? 'offline' : 'error');
    } finally {
      if (handoffGeneration.current === generation) {
        handoffInFlight.current = false;
        setCheckingFreshness(false);
      }
    }
  }, [providerId, router, selectedPincode, selectedSlot, serviceId]);

  const serviceLabel = service ? servicePriceLabel(service as AuthoritativeService) : null;

  return (
    <ScreenShell
      header={(
        <ScreenHeader
          title="Choose grooming time"
          subtitle={provider ? `${provider.name} · PIN ${selectedPincode}` : `PIN ${selectedPincode}`}
          onBack={goBack}
          backLabel="Back from grooming slots"
        />
      )}
      contentContainerStyle={styles.content}
      testID="p10-groomer-slot-discovery-screen"
    >
      {state === 'loading' ? (
        <StateView kind="loading" title="Checking current availability" message="Verifying the provider, service and live appointment slots." />
      ) : null}

      {state === 'feature_disabled' ? (
        <StateView
          kind="empty"
          title={`Grooming is not available in ${activeCity.displayName}`}
          message="Choose another supported service city to continue."
          actionLabel="Change location"
          onAction={openLocationModal}
        />
      ) : null}

      {state === 'invalid_location' ? (
        <StateView
          kind="error"
          title="Select a service PIN"
          message="A valid active six-digit service PIN is required before checking grooming availability."
          actionLabel="Choose location"
          onAction={openLocationModal}
        />
      ) : null}

      {state === 'invalid_provider' || state === 'invalid_service' ? (
        <StateView
          kind="error"
          title={state === 'invalid_provider' ? 'Invalid groomer link' : 'Invalid service link'}
          message="This link does not contain the canonical provider and service identifiers required for slot discovery."
          actionLabel="Go back"
          onAction={goBack}
        />
      ) : null}

      {state === 'unavailable' ? (
        <StateView
          kind="empty"
          title="Groomer unavailable"
          message={`This provider is no longer public, grooming-capable or serviceable for PIN ${selectedPincode}.`}
          actionLabel="Back to groomers"
          onAction={() => router.replace('/grooming' as never)}
        />
      ) : null}

      {state === 'service_unavailable' ? (
        <StateView
          kind="empty"
          title="Service no longer available"
          message="This grooming service is no longer published by the selected provider. Choose another current service."
          actionLabel="Back to services"
          onAction={goBack}
        />
      ) : null}

      {state === 'offline' ? (
        <StateView
          kind="offline"
          title="You're offline"
          message="Reconnect before loading current grooming availability."
          actionLabel="Retry"
          onAction={() => void load('initial')}
        />
      ) : null}

      {state === 'error' ? (
        <StateView
          kind="error"
          title="Availability could not load"
          message="MyPet could not verify the current service and slot catalogue."
          actionLabel="Retry"
          onAction={() => void load('initial')}
        />
      ) : null}

      {state === 'ready' && provider && service ? (
        <>
          <View style={[styles.serviceCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}>
              <AppIcon name="groom" color={theme.primary} size={26} />
            </View>
            <View style={styles.serviceCopy}>
              <ThemedText style={[styles.serviceName, { color: theme.text }]}>{service.name}</ThemedText>
              <ThemedText style={[styles.serviceMeta, { color: theme.textSecondary }]}>
                {service.durationMinutes} minutes · {serviceLabel}
              </ThemedText>
              {service.description ? (
                <ThemedText style={[styles.description, { color: theme.textSecondary }]}>{service.description}</ThemedText>
              ) : null}
            </View>
          </View>

          {refreshFailure ? (
            <View style={[styles.notice, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={[styles.noticeTitle, { color: theme.text }]}>Availability refresh failed</ThemedText>
              <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
                {refreshFailure === 'offline'
                  ? 'Reconnect and retry. Previously verified slots remain visible but are not reserved.'
                  : 'Current availability could not be refreshed. Recheck before continuing.'}
              </ThemedText>
              <PrimaryButton label="Retry refresh" variant="secondary" onPress={() => void load('refresh')} />
            </View>
          ) : null}

          {slotStale ? (
            <StateView
              kind="error"
              title="Selected time is no longer available"
              message="Availability changed. Choose one of the currently returned times; no slot is reserved until the booking step confirms it."
              actionLabel="Refresh slots"
              onAction={() => void load('refresh')}
            />
          ) : null}

          {freshnessFailure ? (
            <StateView
              kind={freshnessFailure === 'offline' ? 'offline' : 'error'}
              title={freshnessFailure === 'offline' ? 'Reconnect before continuing' : 'Could not recheck this time'}
              message="The selected time was not sent to booking because MyPet could not verify its current availability."
              actionLabel="Recheck availability"
              onAction={() => void continueToBooking()}
            />
          ) : null}

          {slots.length === 0 ? (
            <StateView
              kind="empty"
              title="No future times available"
              message="The provider currently has no selectable future slots for this published service in the discovery window."
              actionLabel="Refresh slots"
              onAction={() => void load('refresh')}
            />
          ) : (
            <>
              <View style={styles.section}>
                <View style={styles.sectionHeading}>
                  <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Available dates</ThemedText>
                  <PrimaryButton label="Refresh" variant="secondary" loading={refreshing} onPress={() => void load('refresh')} />
                </View>
                <View style={styles.choiceGrid}>
                  {dates.map((date) => {
                    const selected = date.key === selectedDate;
                    return (
                      <Pressable
                        key={date.key}
                        onPress={() => chooseDate(date.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${date.label}. ${selected ? 'Selected date' : 'Choose date'}.`}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.choice,
                          { backgroundColor: selected ? theme.primarySoft : theme.backgroundElement, borderColor: selected ? theme.primary : theme.border },
                          pressed && styles.pressed,
                        ]}
                      >
                        <ThemedText style={[styles.choiceText, { color: selected ? theme.primary : theme.text }]}>{date.label}</ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.section}>
                <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Available times</ThemedText>
                {visibleSlots.length === 0 ? (
                  <StateView
                    kind="empty"
                    title="No times on this date"
                    message="Choose another date returned by current availability."
                  />
                ) : (
                  <View style={styles.choiceGrid}>
                    {visibleSlots.map((slot) => {
                      const selected = selectedSlot?.id === slot.id && selectedSlot ? sameCanonicalSlot(selectedSlot, slot) : false;
                      const label = slot.startsAt && slot.endsAt
                        ? `${timeLabel(slot.startsAt)} – ${timeLabel(slot.endsAt)}`
                        : 'Time unavailable';
                      return (
                        <Pressable
                          key={slot.id}
                          onPress={() => chooseSlot(slot)}
                          accessibilityRole="button"
                          accessibilityLabel={`${label}. ${selected ? 'Selected time' : 'Choose time'}.`}
                          accessibilityState={{ selected }}
                          style={({ pressed }) => [
                            styles.choice,
                            styles.slotChoice,
                            { backgroundColor: selected ? theme.primarySoft : theme.backgroundElement, borderColor: selected ? theme.primary : theme.border },
                            pressed && styles.pressed,
                          ]}
                        >
                          <ThemedText style={[styles.choiceText, { color: selected ? theme.primary : theme.text }]}>{label}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            </>
          )}

          <View style={[styles.boundaryNote, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}>
            <AppIcon name="calendar" color={theme.primary} size={20} />
            <View style={styles.boundaryCopy}>
              <ThemedText style={[styles.boundaryTitle, { color: theme.text }]}>Selection is not a reservation</ThemedText>
              <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
                MyPet rechecks the selected slot before handing it to booking. The appointment is created only in the next booking phase.
              </ThemedText>
            </View>
          </View>

          <PrimaryButton
            label="Continue to booking"
            disabled={!selectedSlot || checkingFreshness}
            loading={checkingFreshness}
            onPress={() => void continueToBooking()}
          />
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.x4, paddingBottom: spacing.x8 },
  serviceCard: {
    minHeight: 104,
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
  serviceCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  serviceName: { ...typography.headline, fontSize: 17, lineHeight: 24, fontWeight: '800', flexShrink: 1 },
  serviceMeta: { fontSize: 13, lineHeight: 19, fontWeight: '700', flexShrink: 1 },
  description: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x3, gap: spacing.x2 },
  noticeTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  section: { gap: spacing.x3 },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 17, lineHeight: 24, fontWeight: '800' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  choice: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x2,
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  slotChoice: { minWidth: 128 },
  choiceText: { fontSize: 13, lineHeight: 19, fontWeight: '800', textAlign: 'center' },
  boundaryNote: { flexDirection: 'row', gap: spacing.x3, padding: spacing.x4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card },
  boundaryCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  boundaryTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  pressed: { opacity: 0.82 },
});
