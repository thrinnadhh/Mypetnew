import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet, EntityCard, FilterChip, PrimaryAction, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ScreenHeader } from '@/components/ui/screen-header';
import { INITIAL_MARKET } from '@/config/markets';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, spacing, touchTarget } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  fetchAvailableAppointmentSlots,
  holdAppointmentSlot,
  type AppointmentSlotOption,
} from '@/services/appointment-booking';
import { isOfflineError } from '@/services/customer-profile';
import {
  createCustomerPet,
  fetchCustomerPets,
  type CustomerPet,
} from '@/services/customer-pets';
import {
  fetchProviders,
  type DiscoverableProviderType,
  type ProviderSummary,
} from '@/services/provider-discovery';

interface Props {
  providerType: DiscoverableProviderType;
  route: '/vet' | '/groom';
  titleKey: 'appointmentFoundation.vetTitle' | 'appointmentFoundation.groomTitle';
}

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

export default function AppointmentDiscoveryScreen({ providerType, route, titleKey }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [provider, setProvider] = useState<ProviderSummary | null>(null);
  const [slots, setSlots] = useState<AppointmentSlotOption[]>([]);
  const [slotState, setSlotState] = useState<LoadState>('ready');
  const [pets, setPets] = useState<CustomerPet[]>([]);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [petsLoading, setPetsLoading] = useState(false);
  const [petName, setPetName] = useState('');
  const [petSpecies, setPetSpecies] = useState<'DOG' | 'CAT'>('DOG');
  const [creatingPet, setCreatingPet] = useState(false);
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setState('loading');
    try {
      setProviders(await fetchProviders(providerType, INITIAL_MARKET));
      setState('ready');
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [providerType]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const loadPets = useCallback(async () => {
    if (!session) {
      setPets([]);
      setSelectedPetId(null);
      return;
    }
    setPetsLoading(true);
    try {
      const values = await fetchCustomerPets(session.access_token);
      setPets(values);
      setSelectedPetId((current) =>
        current && values.some((pet) => pet.petId === current)
          ? current
          : values[0]?.petId ?? null,
      );
    } catch (error) {
      Alert.alert('Pets unavailable', error instanceof Error ? error.message : 'Could not load your pets.');
    } finally {
      setPetsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadPets();
  }, [loadPets]);

  const chooseProvider = useCallback(async (next: ProviderSummary) => {
    setProvider(next);
    setSlots([]);
    setSlotState('loading');
    try {
      setSlots(await fetchAvailableAppointmentSlots(next.id));
      setSlotState('ready');
    } catch (error) {
      setSlotState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, []);

  const createPet = useCallback(async () => {
    if (!session || petName.trim().length < 2) return;
    setCreatingPet(true);
    try {
      const created = await createCustomerPet(
        { name: petName.trim(), species: petSpecies },
        session.access_token,
      );
      setPets((current) => [...current, created]);
      setSelectedPetId(created.petId);
      setPetName('');
    } catch (error) {
      Alert.alert('Pet not saved', error instanceof Error ? error.message : 'Could not save pet.');
    } finally {
      setCreatingPet(false);
    }
  }, [petName, petSpecies, session]);

  const requestBooking = useCallback(async (slot: AppointmentSlotOption) => {
    const authenticated = await requireAuth({ action: 'BOOKING', returnTo: route });
    if (!authenticated || !user || !session) return;
    if (!selectedPetId) {
      Alert.alert('Select a pet', 'Choose or add the pet attending this appointment.');
      return;
    }

    setBookingSlotId(slot.id);
    try {
      const appointmentId = await holdAppointmentSlot({
        slot,
        userId: user.id,
        petId: selectedPetId,
        accessToken: session.access_token,
      });
      const selectedPet = pets.find((pet) => pet.petId === selectedPetId);
      router.push({
        pathname: '/appointments/payment',
        params: {
          appointmentId,
          serviceName: slot.serviceName,
          providerName: provider?.name ?? 'MyPet provider',
          petName: selectedPet?.name ?? 'Your pet',
          slotStart: slot.startTime,
          slotEnd: slot.endTime,
          amount: String(slot.price),
        },
      } as never);
      setProvider(null);
      setSlots([]);
    } catch (error) {
      Alert.alert('Booking failed', error instanceof Error ? error.message : 'Could not reserve this appointment.');
      if (provider) await chooseProvider(provider);
    } finally {
      setBookingSlotId(null);
    }
  }, [chooseProvider, pets, provider, requireAuth, route, router, selectedPetId, session, user]);

  const close = () => {
    if (bookingSlotId) return;
    setProvider(null);
    setSlots([]);
  };

  return (
    <ScreenShell
      header={<ScreenHeader title={t(titleKey)} subtitle={t('appointmentFoundation.subtitle')} />}
      testID={`${providerType.toLowerCase()}-discovery-screen`}
    >
      {state === 'loading' ? <StateView kind="loading" title={t('states.loading')} /> : null}
      {state === 'offline' || state === 'error' ? (
        <StateView
          kind={state}
          title={t(state === 'offline' ? 'states.offline' : 'states.error')}
          message={t(state === 'offline' ? 'states.offlineMessage' : 'states.errorMessage')}
          actionLabel={t('states.retry')}
          onAction={() => void loadProviders()}
        />
      ) : null}
      {state === 'ready' && providers.length === 0 ? (
        <StateView kind="empty" title={t('states.empty')} message={t('states.emptyMessage')} />
      ) : null}
      {state === 'ready' ? (
        <View style={styles.list}>
          {providers.map((item) => (
            <EntityCard
              key={item.id}
              title={item.name}
              subtitle={item.description || t('appointmentFoundation.providerFallback')}
              meta={t('appointmentFoundation.providerMeta', {
                distance: item.distanceKm.toFixed(1),
                rating: item.rating.toFixed(1),
                count: item.ratingCount,
              })}
              icon={providerType === 'GROOMER' ? 'groom' : 'medical'}
              onPress={() => void chooseProvider(item)}
            />
          ))}
        </View>
      ) : null}

      <BottomSheet visible={Boolean(provider)} title={t('appointmentFoundation.slots')} onClose={close}>
        {session ? (
          <View style={styles.petSection}>
            {petsLoading ? <StateView kind="loading" title="Loading your pets" /> : null}
            {!petsLoading && pets.length > 0 ? (
              <View style={styles.row}>
                {pets.map((pet) => (
                  <FilterChip
                    key={pet.petId}
                    label={`${pet.name} · ${pet.species}`}
                    selected={selectedPetId === pet.petId}
                    onPress={() => setSelectedPetId(pet.petId)}
                  />
                ))}
              </View>
            ) : null}
            {!petsLoading && pets.length === 0 ? (
              <View style={styles.petForm}>
                <TextInput
                  value={petName}
                  onChangeText={setPetName}
                  placeholder="Pet name"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                />
                <View style={styles.row}>
                  <FilterChip label="Dog" selected={petSpecies === 'DOG'} onPress={() => setPetSpecies('DOG')} />
                  <FilterChip label="Cat" selected={petSpecies === 'CAT'} onPress={() => setPetSpecies('CAT')} />
                </View>
                <PrimaryAction
                  label="Save pet"
                  disabled={petName.trim().length < 2}
                  loading={creatingPet}
                  onPress={() => void createPet()}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {slotState === 'loading' ? <StateView kind="loading" title={t('states.loading')} /> : null}
        {slotState === 'offline' || slotState === 'error' ? (
          <StateView
            kind={slotState}
            title={t(slotState === 'offline' ? 'states.offline' : 'states.error')}
            message={t(slotState === 'offline' ? 'states.offlineMessage' : 'appointmentFoundation.holdFailed')}
            actionLabel={provider ? t('states.retry') : undefined}
            onAction={provider ? () => void chooseProvider(provider) : undefined}
          />
        ) : null}
        {slotState === 'ready' && slots.length === 0 ? (
          <StateView kind="empty" title={t('appointmentFoundation.noSlots')} />
        ) : null}
        {slotState === 'ready' ? (
          <View style={styles.list}>
            {slots.map((slot) => (
              <EntityCard
                key={slot.id}
                title={slot.serviceName}
                subtitle={`${slot.startTime} – ${slot.endTime}`}
                meta={bookingSlotId === slot.id ? 'Reserving slot…' : `₹${slot.price} · Tap to review & pay`}
                icon="calendar"
                onPress={() => {
                  if (!bookingSlotId) void requestBooking(slot);
                }}
              />
            ))}
          </View>
        ) : null}
      </BottomSheet>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.x3 },
  petSection: { gap: spacing.x3, marginBottom: spacing.x3 },
  petForm: { gap: spacing.x3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4 },
});
