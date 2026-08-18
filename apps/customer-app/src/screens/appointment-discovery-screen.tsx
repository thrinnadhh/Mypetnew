import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet, EntityCard, FilterChip, PrimaryAction, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { INITIAL_MARKET } from '@/config/markets';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useLocation } from '@/context/LocationContext';
import { radii, spacing, touchTarget } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  fetchAvailableAppointmentSlots,
  holdAppointmentSlot,
  type AppointmentPaymentMethod,
  type AppointmentServiceCapability,
  type AppointmentSlotOption,
} from '@/services/appointment-booking';
import { isOfflineError } from '@/services/customer-profile';
import {
  createCustomerPet,
  fetchCustomerPets,
  type CustomerPet,
} from '@/services/customer-pets';
import {
  fetchProviderPage,
  mergeUniqueProviders,
  PROVIDER_DISCOVERY_PAGE_SIZE,
  type DiscoverableProviderType,
  type ProviderSummary,
} from '@/services/provider-discovery';
import { fetchProviderProfile, type ProviderProfileKind } from '@/services/provider-profile';

interface Props {
  providerType: DiscoverableProviderType;
  route: '/vet' | '/groom';
  titleKey: 'appointmentFoundation.vetTitle' | 'appointmentFoundation.groomTitle';
}

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function AppointmentDiscoveryScreen({ providerType, route, titleKey }: Props) {
  const router = useRouter();
  const params = useLocalSearchParams<{ providerId?: string | string[]; serviceId?: string | string[] }>();
  const preferredProviderId = single(params.providerId);
  const preferredServiceId = single(params.serviceId);
  const theme = useTheme();
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { activeCity, selectedPincode } = useLocation();
  const serviceCapability: AppointmentServiceCapability = providerType === 'GROOMER' ? 'GROOMING' : 'VETERINARY';
  const providerKind: ProviderProfileKind = providerType === 'GROOMER' ? 'groomer' : 'vet';
  const careEnabled = providerType === 'GROOMER'
    ? activeCity.featureFlags.allowGrooming
    : activeCity.featureFlags.allowVet;
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [hasNext, setHasNext] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const providerRequestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);
  const [provider, setProvider] = useState<ProviderSummary | null>(null);
  const [slots, setSlots] = useState<AppointmentSlotOption[]>([]);
  const [slotState, setSlotState] = useState<LoadState>('ready');
  const [pets, setPets] = useState<CustomerPet[]>([]);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<AppointmentPaymentMethod>('ONLINE_PAYMENT');
  const [petsLoading, setPetsLoading] = useState(false);
  const [petName, setPetName] = useState('');
  const [petSpecies, setPetSpecies] = useState<'DOG' | 'CAT'>('DOG');
  const [creatingPet, setCreatingPet] = useState(false);
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const generation = providerRequestGeneration.current + 1;
    providerRequestGeneration.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    setState('loading');
    setProvider(null);
    setSlots([]);
    setProviders([]);
    setHasNext(false);

    if (!careEnabled) {
      setState('ready');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(selectedPincode)) {
      setState('error');
      return;
    }

    try {
      const response = await fetchProviderPage(providerType, INITIAL_MARKET, selectedPincode, {
        page: 0,
        pageSize: PROVIDER_DISCOVERY_PAGE_SIZE,
      });
      if (providerRequestGeneration.current !== generation) return;

      let firstPageItems = response.items;
      if (preferredProviderId && !firstPageItems.some((item) => item.id === preferredProviderId)) {
        const directProvider = await fetchProviderProfile(preferredProviderId, {
          kind: providerKind,
          pincode: selectedPincode,
        });
        if (providerRequestGeneration.current !== generation) return;
        if (!directProvider.organizationId) {
          throw new Error('PROVIDER_IDENTITY_UNAVAILABLE');
        }
        firstPageItems = mergeUniqueProviders(firstPageItems, [{
          id: directProvider.providerId,
          organizationId: directProvider.organizationId,
          name: directProvider.name,
          description: directProvider.description ?? '',
          capabilities: directProvider.capabilities,
          pickupEnabled: directProvider.pickupEnabled,
        }]);
      }

      setProviders(firstPageItems);
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
      setState('ready');
    } catch (error) {
      if (providerRequestGeneration.current !== generation) return;
      setProviders([]);
      setHasNext(false);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [careEnabled, preferredProviderId, providerKind, providerType, selectedPincode]);

  useEffect(() => {
    void loadProviders();
    return () => {
      providerRequestGeneration.current += 1;
    };
  }, [loadProviders]);

  const loadNextProviders = useCallback(async () => {
    if (!hasNext || loadingMoreRef.current || !/^[1-9][0-9]{5}$/.test(selectedPincode)) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const generation = providerRequestGeneration.current;

    try {
      const response = await fetchProviderPage(providerType, INITIAL_MARKET, selectedPincode, {
        page: nextPage,
        pageSize: PROVIDER_DISCOVERY_PAGE_SIZE,
      });
      if (providerRequestGeneration.current !== generation) return;
      setProviders((current) => mergeUniqueProviders(current, response.items));
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
    } catch (error) {
      if (providerRequestGeneration.current !== generation) return;
      setLoadMoreError(
        isOfflineError(error)
          ? 'Reconnect to load more serviceable providers.'
          : 'Could not load more serviceable providers.',
      );
    } finally {
      if (providerRequestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasNext, nextPage, providerType, selectedPincode]);

  const loadPets = useCallback(async () => {
    if (!session) {
      setPets([]);
      setSelectedPetId(null);
      return;
    }
    setPetsLoading(true);
    try {
      const values = await fetchCustomerPets(session.accessToken);
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

  const chooseProvider = useCallback(async (next: ProviderSummary, serviceId?: string) => {
    setProvider(next);
    setSlots([]);
    setSlotState('loading');
    try {
      setSlots(await fetchAvailableAppointmentSlots(next.id, serviceId, serviceCapability));
      setSlotState('ready');
    } catch (error) {
      setSlotState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [serviceCapability]);

  useEffect(() => {
    if (state !== 'ready' || provider || !preferredProviderId) return;
    const preferred = providers.find((item) => item.id === preferredProviderId);
    if (preferred) void chooseProvider(preferred, preferredServiceId);
  }, [chooseProvider, preferredProviderId, preferredServiceId, provider, providers, state]);

  const createPet = useCallback(async () => {
    if (!session || petName.trim().length < 2) return;
    setCreatingPet(true);
    try {
      const created = await createCustomerPet(
        { name: petName.trim(), species: petSpecies },
        session.accessToken,
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
        paymentMethod,
        accessToken: session.accessToken,
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
          paymentMethod,
        },
      } as never);
      setProvider(null);
      setSlots([]);
    } catch (error) {
      Alert.alert('Booking failed', error instanceof Error ? error.message : 'Could not reserve this appointment.');
      if (provider) {
        await chooseProvider(provider, provider.id === preferredProviderId ? preferredServiceId : undefined);
      }
    } finally {
      setBookingSlotId(null);
    }
  }, [chooseProvider, paymentMethod, pets, preferredProviderId, preferredServiceId, provider, requireAuth, route, router, selectedPetId, session, user]);

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
          message={state === 'offline'
            ? t('states.offlineMessage')
            : `Select a valid live service PIN to discover ${providerType === 'GROOMER' ? 'groomers' : 'veterinary providers'}.`}
          actionLabel={t('states.retry')}
          onAction={() => void loadProviders()}
        />
      ) : null}
      {state === 'ready' && !careEnabled ? (
        <StateView
          kind="empty"
          title={`${providerType === 'GROOMER' ? 'Grooming' : 'Veterinary care'} is not enabled in ${activeCity.displayName}`}
          message="Choose another service city to see providers that can accept bookings."
        />
      ) : null}
      {state === 'ready' && careEnabled && providers.length === 0 ? (
        <StateView
          kind="empty"
          title={t('states.empty')}
          message={`No serviceable ${providerType === 'GROOMER' ? 'groomers' : 'veterinary providers'} are available for PIN ${selectedPincode}.`}
        />
      ) : null}
      {state === 'ready' && careEnabled && providers.length > 0 ? (
        <View style={styles.list}>
          {providers.map((item) => (
            <EntityCard
              key={item.id}
              title={item.name}
              subtitle={item.description || t('appointmentFoundation.providerFallback')}
              meta={`Serves PIN ${selectedPincode}`}
              icon={providerType === 'GROOMER' ? 'groom' : 'medical'}
              onPress={() => void chooseProvider(item)}
            />
          ))}
          {loadMoreError ? (
            <View style={styles.paginationFooter}>
              <StateView kind="error" title="More providers unavailable" message={loadMoreError} />
              <PrimaryButton label="Retry loading more" variant="secondary" onPress={() => void loadNextProviders()} />
            </View>
          ) : hasNext ? (
            <View style={styles.paginationFooter}>
              <PrimaryButton
                label="Load more providers"
                variant="secondary"
                loading={loadingMore}
                onPress={() => void loadNextProviders()}
              />
            </View>
          ) : null}
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

        <View style={styles.paymentSection}>
          <View style={styles.row}>
            <FilterChip
              label="Pay online"
              selected={paymentMethod === 'ONLINE_PAYMENT'}
              onPress={() => setPaymentMethod('ONLINE_PAYMENT')}
            />
            <FilterChip
              label="Pay at provider"
              selected={paymentMethod === 'PAY_AT_PROVIDER'}
              onPress={() => setPaymentMethod('PAY_AT_PROVIDER')}
            />
          </View>
        </View>

        {slotState === 'loading' ? <StateView kind="loading" title={t('states.loading')} /> : null}
        {slotState === 'offline' || slotState === 'error' ? (
          <StateView
            kind={slotState}
            title={t(slotState === 'offline' ? 'states.offline' : 'states.error')}
            message={t(slotState === 'offline' ? 'states.offlineMessage' : 'appointmentFoundation.holdFailed')}
            actionLabel={provider ? t('states.retry') : undefined}
            onAction={provider ? () => void chooseProvider(provider, provider.id === preferredProviderId ? preferredServiceId : undefined) : undefined}
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
                meta={
                  bookingSlotId === slot.id
                    ? 'Reserving slot…'
                    : `₹${slot.price} · ${paymentMethod === 'ONLINE_PAYMENT' ? 'Pay online' : 'Pay at provider'} · Tap to review`
                }
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
  paginationFooter: { gap: spacing.x2, paddingVertical: spacing.x2 },
  petSection: { gap: spacing.x3, marginBottom: spacing.x3 },
  paymentSection: { gap: spacing.x2, marginBottom: spacing.x3 },
  petForm: { gap: spacing.x3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4 },
});
