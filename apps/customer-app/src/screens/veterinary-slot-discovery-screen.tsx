import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

type LoadState = 'loading' | 'ready' | 'offline' | 'error' | 'unavailable' | 'service_unavailable' | 'invalid_input' | 'invalid_location' | 'feature_disabled';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_PIN_PATTERN = /^[1-9][0-9]{5}$/;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function canonicalDateKey(instant: string | undefined): string | null {
  if (!instant) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_DISPLAY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function dateLabel(instant: string): string {
  return new Date(instant).toLocaleDateString('en-IN', {
    timeZone: APPOINTMENT_DISPLAY_TIME_ZONE,
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function timeLabel(instant: string): string {
  return new Date(instant).toLocaleTimeString('en-IN', {
    timeZone: APPOINTMENT_DISPLAY_TIME_ZONE,
    hour: '2-digit', minute: '2-digit',
  });
}

function sameSlot(left: AppointmentSlotOption, right: AppointmentSlotOption): boolean {
  return left.id === right.id
    && left.providerId === right.providerId
    && left.offeringId === right.offeringId
    && left.startsAt === right.startsAt
    && left.endsAt === right.endsAt;
}

export default function VeterinarySlotDiscoveryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { activeCity, selectedPincode, openLocationModal } = useLocation();
  const params = useLocalSearchParams<{ slug?: string | string[]; serviceId?: string | string[] }>();
  const providerId = single(params.slug);
  const serviceId = single(params.serviceId);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [service, setService] = useState<AppointmentServiceOption | null>(null);
  const [slots, setSlots] = useState<AppointmentSlotOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AppointmentSlotOption | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [checkingFreshness, setCheckingFreshness] = useState(false);
  const [slotStale, setSlotStale] = useState(false);
  const requestGeneration = useRef(0);
  const handoffGeneration = useRef(0);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (providerId) router.replace(`/vet/${encodeURIComponent(providerId)}` as never);
    else router.replace('/vet' as never);
  }, [providerId, router]);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    handoffGeneration.current += 1;
    setCheckingFreshness(false);
    setProvider(null);
    setService(null);
    setSlots([]);
    setSelectedDate(null);
    setSelectedSlot(null);
    setSlotStale(false);

    if (!activeCity.featureFlags.allowVet) {
      setState('feature_disabled');
      return;
    }
    if (!providerId || !serviceId || !UUID_PATTERN.test(providerId) || !UUID_PATTERN.test(serviceId)) {
      setState('invalid_input');
      return;
    }
    if (!SERVICE_PIN_PATTERN.test(selectedPincode)) {
      setState('invalid_location');
      return;
    }

    setState('loading');
    try {
      const currentProvider = await fetchProviderProfile(providerId, { kind: 'vet', pincode: selectedPincode });
      if (requestGeneration.current !== generation) return;
      const published = await fetchAppointmentServices({ providerId, capability: 'VETERINARY' });
      if (requestGeneration.current !== generation) return;
      const currentService = published.find((item) => item.id === serviceId);
      if (!currentService || currentService.providerId !== providerId || currentService.capability !== 'VETERINARY') {
        setProvider(currentProvider);
        setState('service_unavailable');
        return;
      }
      const currentSlots = await fetchAvailableAppointmentSlots(providerId, serviceId, 'VETERINARY');
      if (requestGeneration.current !== generation) return;
      if (currentSlots.some((slot) => slot.providerId !== providerId || slot.offeringId !== serviceId || !slot.startsAt || !slot.endsAt)) {
        throw new Error('SLOT_CONTEXT_MISMATCH');
      }
      await fetchProviderProfile(providerId, { kind: 'vet', pincode: selectedPincode });
      if (requestGeneration.current !== generation) return;
      const dates = [...new Set(currentSlots.map((slot) => canonicalDateKey(slot.startsAt)).filter(Boolean) as string[])];
      setProvider(currentProvider);
      setService(currentService);
      setSlots(currentSlots);
      setSelectedDate(dates[0] ?? null);
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      if (isOfflineError(error)) setState('offline');
      else if (error instanceof ApiError && error.status === 404) setState('unavailable');
      else if (error instanceof Error && error.name === 'SERVICE_NOT_AVAILABLE') setState('service_unavailable');
      else setState('error');
    }
  }, [activeCity.featureFlags.allowVet, providerId, selectedPincode, serviceId]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
      handoffGeneration.current += 1;
    };
  }, [load]);

  const dates = useMemo(() => {
    const unique = new Map<string, string>();
    for (const slot of slots) {
      const key = canonicalDateKey(slot.startsAt);
      if (key && slot.startsAt && !unique.has(key)) unique.set(key, slot.startsAt);
    }
    return [...unique.entries()].map(([key, instant]) => ({ key, label: dateLabel(instant) }));
  }, [slots]);

  const visibleSlots = useMemo(
    () => slots.filter((slot) => canonicalDateKey(slot.startsAt) === selectedDate),
    [selectedDate, slots],
  );

  const chooseDate = useCallback((date: string) => {
    if (checkingFreshness) return;
    setSelectedDate(date);
    setSelectedSlot(null);
    setSlotStale(false);
  }, [checkingFreshness]);

  const chooseSlot = useCallback((slot: AppointmentSlotOption) => {
    if (checkingFreshness) return;
    if (slot.providerId !== providerId || slot.offeringId !== serviceId || !slot.startsAt || !slot.endsAt) return;
    setSelectedSlot(slot);
    setSlotStale(false);
  }, [checkingFreshness, providerId, serviceId]);

  const continueToBooking = useCallback(async () => {
    if (!providerId || !serviceId || !selectedSlot || !selectedSlot.startsAt || !selectedSlot.endsAt || !SERVICE_PIN_PATTERN.test(selectedPincode) || checkingFreshness) return;
    const generation = handoffGeneration.current + 1;
    handoffGeneration.current = generation;
    const chosen = selectedSlot;
    setCheckingFreshness(true);
    try {
      await fetchProviderProfile(providerId, { kind: 'vet', pincode: selectedPincode });
      if (handoffGeneration.current !== generation) return;
      const latest = await fetchAvailableAppointmentSlots(providerId, serviceId, 'VETERINARY');
      if (handoffGeneration.current !== generation) return;
      const current = latest.find((slot) => slot.id === chosen.id);
      if (!current || !sameSlot(chosen, current)) {
        setSlots(latest);
        setSelectedSlot(null);
        setSelectedDate(canonicalDateKey(latest[0]?.startsAt));
        setSlotStale(true);
        return;
      }
      await fetchProviderProfile(providerId, { kind: 'vet', pincode: selectedPincode });
      if (handoffGeneration.current !== generation) return;
      router.push({
        pathname: '/vet',
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
      if (isOfflineError(error)) setState('offline');
      else if (error instanceof ApiError && error.status === 404) setState('unavailable');
      else setState('error');
    } finally {
      if (handoffGeneration.current === generation) setCheckingFreshness(false);
    }
  }, [checkingFreshness, providerId, router, selectedPincode, selectedSlot, serviceId]);

  return (
    <ScreenShell
      header={<ScreenHeader title="Choose veterinary time" subtitle={provider ? `${provider.name} · PIN ${selectedPincode}` : `PIN ${selectedPincode}`} onBack={goBack} backLabel="Back from veterinary slot discovery" />}
      contentContainerStyle={styles.content}
      testID="p11-veterinary-slot-discovery-screen"
    >
      {state === 'loading' ? <StateView kind="loading" title="Loading available times" message="Verifying the provider, service and current veterinary availability." /> : null}
      {state === 'feature_disabled' ? <StateView kind="empty" title={`Veterinary care is not available in ${activeCity.displayName}`} message="Choose another service city." actionLabel="Change location" onAction={openLocationModal} /> : null}
      {state === 'invalid_location' ? <StateView kind="error" title="Select a service PIN" message="A valid active service PIN is required before loading veterinary availability." actionLabel="Choose location" onAction={openLocationModal} /> : null}
      {state === 'invalid_input' ? <StateView kind="error" title="Invalid veterinary service link" message="This link does not contain a valid provider and service identity." actionLabel="Back" onAction={goBack} /> : null}
      {state === 'unavailable' ? <StateView kind="empty" title="Veterinary provider unavailable" message={`The provider is no longer public, veterinary-capable or serviceable for PIN ${selectedPincode}.`} actionLabel="Back to veterinary care" onAction={() => router.replace('/vet' as never)} /> : null}
      {state === 'service_unavailable' ? <StateView kind="empty" title="Veterinary service unavailable" message="This service is no longer published by the selected provider." actionLabel="Back to provider" onAction={goBack} /> : null}
      {state === 'offline' ? <StateView kind="offline" title="You're offline" message="Reconnect to verify current veterinary availability." actionLabel="Retry" onAction={() => void load()} /> : null}
      {state === 'error' ? <StateView kind="error" title="Available times could not load" message="MyPet could not verify the current provider, service or slot catalogue." actionLabel="Retry" onAction={() => void load()} /> : null}

      {state === 'ready' && provider && service ? (
        <>
          <View style={[styles.summary, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={[styles.title, { color: theme.text }]}>{service.name}</ThemedText>
            <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>{service.durationMinutes} minutes · {service.currency === 'INR' ? '₹' : `${service.currency} `}{(service.pricePaise / 100).toFixed(service.pricePaise % 100 === 0 ? 0 : 2)}</ThemedText>
            <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>Times shown in {APPOINTMENT_DISPLAY_TIME_ZONE}.</ThemedText>
          </View>

          {slots.length === 0 ? <StateView kind="empty" title="No veterinary slots available" message="This provider currently has no published future availability for the selected service." actionLabel="Refresh" onAction={() => void load()} /> : (
            <>
              <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Choose a date</ThemedText>
              <View style={styles.wrap}>
                {dates.map((date) => <Pressable key={date.key} disabled={checkingFreshness} onPress={() => chooseDate(date.key)} accessibilityRole="button" accessibilityState={{ selected: selectedDate === date.key, disabled: checkingFreshness }} style={[styles.choice, { borderColor: selectedDate === date.key ? theme.primary : theme.border, backgroundColor: theme.backgroundElement }]}><ThemedText style={{ color: theme.text }}>{date.label}</ThemedText></Pressable>)}
              </View>
              <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Available times</ThemedText>
              <View style={styles.wrap}>
                {visibleSlots.map((slot) => <Pressable key={slot.id} disabled={checkingFreshness} onPress={() => chooseSlot(slot)} accessibilityRole="button" accessibilityState={{ selected: selectedSlot?.id === slot.id, disabled: checkingFreshness }} accessibilityLabel={`${timeLabel(slot.startsAt as string)} veterinary appointment slot`} style={[styles.choice, { borderColor: selectedSlot?.id === slot.id ? theme.primary : theme.border, backgroundColor: theme.backgroundElement }]}><ThemedText style={{ color: theme.text }}>{timeLabel(slot.startsAt as string)}</ThemedText></Pressable>)}
              </View>
              {slotStale ? <StateView kind="error" title="That slot changed" message="The selected time is no longer available. Choose another current slot." /> : null}
              <PrimaryButton label="Continue to booking" disabled={!selectedSlot || checkingFreshness} loading={checkingFreshness} onPress={() => void continueToBooking()} />
              <ThemedText style={[styles.boundary, { color: theme.textSecondary }]}>Selecting a time does not reserve or create an appointment. The booking flow revalidates availability before requesting this slot.</ThemedText>
            </>
          )}
        </>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.x4, paddingBottom: spacing.x8 },
  summary: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x2 },
  title: { ...typography.headline, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  meta: { fontSize: 13, lineHeight: 19 },
  sectionTitle: { ...typography.headline, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  choice: { minHeight: touchTarget, minWidth: touchTarget * 2, paddingHorizontal: spacing.x3, borderWidth: 1, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  boundary: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
