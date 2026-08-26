import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, PrimaryAction, SectionHeader, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { LANGUAGES } from '@/constants/content';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useLocale } from '@/context/LocaleContext';
import { radii, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  createCustomerAddress,
  deleteCustomerAddress,
  fetchCustomerAddresses,
  fetchCustomerProfile,
  isOfflineError,
  normalizeDeliveryPhone,
  updateCustomerAddress,
  updateCustomerProfile,
  type AddressInput,
  type CustomerAddress,
  type CustomerProfile,
} from '@/services/customer-profile';
import {
  createCustomerPet,
  deleteCustomerPet,
  fetchCustomerPets,
  updateCustomerPet,
  type CustomerPet,
  type PetSpecies,
} from '@/services/customer-pets';

type PetDraft = {
  petId: string | null;
  name: string;
  species: PetSpecies;
  breed: string;
  dateOfBirth: string;
};

type AddressDraft = {
  addressId: string | null;
  label: string;
  recipientName: string;
  phoneNumber: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

const emptyPet: PetDraft = { petId: null, name: '', species: 'DOG', breed: '', dateOfBirth: '' };
const emptyAddress: AddressDraft = {
  addressId: null,
  label: 'Home',
  recipientName: '',
  phoneNumber: '',
  line1: '',
  line2: '',
  city: 'Tirupati',
  state: 'Andhra Pradesh',
  pincode: '',
  isDefault: true,
};

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const { user, session, signOut } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { locale, changeLocale } = useLocale();

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [pets, setPets] = useState<CustomerPet[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [petDraft, setPetDraft] = useState<PetDraft>(emptyPet);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddress);
  const [showPetForm, setShowPetForm] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<'offline' | 'error' | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPet, setSavingPet] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [nextProfile, nextPets, nextAddresses] = await Promise.all([
        fetchCustomerProfile(session.accessToken),
        fetchCustomerPets(session.accessToken),
        fetchCustomerAddresses(session.accessToken),
      ]);
      setProfile(nextProfile);
      setProfileName(nextProfile.name ?? '');
      setProfileEmail(nextProfile.email ?? '');
      setPets(nextPets);
      setAddresses(nextAddresses);
    } catch (error) {
      setLoadError(isOfflineError(error) ? 'offline' : 'error');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (user && session) void load();
  }, [load, session, user]);

  const profileRows = useMemo(() => {
    if (!profile) return [];
    return [
      { label: t('profileFoundation.displayName'), value: profile.name ?? '—', complete: Boolean(profile.name) },
      { label: t('profileFoundation.verifiedMobile'), value: profile.mobile, complete: true },
      { label: 'Email', value: profile.email ?? 'Optional', complete: true },
    ];
  }, [profile, t]);

  const saveProfile = useCallback(async () => {
    if (!session) return;
    setSavingProfile(true);
    try {
      const updated = await updateCustomerProfile(session.accessToken, {
        name: profileName.trim(),
        email: profileEmail.trim(),
      });
      setProfile(updated);
      setProfileName(updated.name ?? '');
      setProfileEmail(updated.email ?? '');
      Alert.alert(t('common.success'), 'Profile saved.');
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : t('states.errorMessage'));
    } finally {
      setSavingProfile(false);
    }
  }, [profileEmail, profileName, session, t]);

  const startPet = (pet?: CustomerPet) => {
    if (pet) {
      setPetDraft({
        petId: pet.petId,
        name: pet.name,
        species: pet.species,
        breed: pet.breed ?? '',
        dateOfBirth: pet.dateOfBirth ?? '',
      });
    } else {
      setPetDraft(emptyPet);
    }
    setShowPetForm(true);
  };

  const savePet = useCallback(async () => {
    if (!session) return;
    const name = petDraft.name.trim();
    if (!name) {
      Alert.alert(t('common.error'), t('profileFoundation.petRequired'));
      return;
    }
    setSavingPet(true);
    try {
      const input = {
        name,
        species: petDraft.species,
        breed: petDraft.breed.trim() || null,
        dateOfBirth: petDraft.dateOfBirth.trim() || null,
      };
      const saved = petDraft.petId
        ? await updateCustomerPet(petDraft.petId, input, session.accessToken)
        : await createCustomerPet(input, session.accessToken);
      setPets((current) => {
        const without = current.filter((pet) => pet.petId !== saved.petId);
        return [...without, saved];
      });
      setPetDraft(emptyPet);
      setShowPetForm(false);
      Alert.alert(t('common.success'), t('profileFoundation.petSaved'));
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : t('states.errorMessage'));
    } finally {
      setSavingPet(false);
    }
  }, [petDraft, session, t]);

  const removePet = useCallback((pet: CustomerPet) => {
    if (!session) return;
    Alert.alert('Remove pet?', `${pet.name} will be removed from your MyPet profile.`, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void (async () => {
          try {
            await deleteCustomerPet(pet.petId, session.accessToken);
            setPets((current) => current.filter((item) => item.petId !== pet.petId));
          } catch (error) {
            Alert.alert(t('common.error'), error instanceof Error ? error.message : t('states.errorMessage'));
          }
        })(),
      },
    ]);
  }, [session, t]);

  const startAddress = (address?: CustomerAddress) => {
    if (address) {
      setAddressDraft({
        addressId: address.addressId,
        label: address.label,
        recipientName: address.recipientName,
        phoneNumber: address.phoneNumber,
        line1: address.line1,
        line2: address.line2 ?? '',
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        isDefault: address.isDefault,
      });
    } else {
      setAddressDraft({
        ...emptyAddress,
        recipientName: profile?.name ?? '',
        phoneNumber: profile?.mobile ?? user?.phone ?? '',
        isDefault: addresses.length === 0,
      });
    }
    setShowAddressForm(true);
  };

  const saveAddress = useCallback(async () => {
    if (!session) return;
    let phoneNumber: string;
    try {
      phoneNumber = normalizeDeliveryPhone(addressDraft.phoneNumber);
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : 'Enter a valid mobile number.');
      return;
    }
    if (!addressDraft.recipientName.trim() || !addressDraft.line1.trim() || !/^[1-9]\d{5}$/.test(addressDraft.pincode)) {
      Alert.alert(t('common.error'), t('profileFoundation.addressRequired'));
      return;
    }

    const input: AddressInput = {
      label: addressDraft.label.trim() || 'Home',
      recipientName: addressDraft.recipientName.trim(),
      phoneNumber,
      line1: addressDraft.line1.trim(),
      line2: addressDraft.line2.trim() || null,
      city: addressDraft.city.trim(),
      state: addressDraft.state.trim(),
      pincode: addressDraft.pincode.trim(),
      isDefault: addressDraft.isDefault,
    };

    setSavingAddress(true);
    try {
      const saved = addressDraft.addressId
        ? await updateCustomerAddress(session.accessToken, addressDraft.addressId, input)
        : await createCustomerAddress(session.accessToken, input);
      setAddresses((current) => {
        const normalized = current
          .filter((address) => address.addressId !== saved.addressId)
          .map((address) => saved.isDefault ? { ...address, isDefault: false } : address);
        return [saved, ...normalized].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      });
      setAddressDraft(emptyAddress);
      setShowAddressForm(false);
      Alert.alert(t('common.success'), t('profileFoundation.addressAndContactSaved'));
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : t('states.errorMessage'));
    } finally {
      setSavingAddress(false);
    }
  }, [addressDraft, session, t]);

  const removeAddress = useCallback((address: CustomerAddress) => {
    if (!session) return;
    Alert.alert('Delete address?', `${address.label} will be removed from your saved addresses.`, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void (async () => {
          try {
            await deleteCustomerAddress(session.accessToken, address.addressId);
            const next = await fetchCustomerAddresses(session.accessToken);
            setAddresses(next);
          } catch (error) {
            Alert.alert(t('common.error'), error instanceof Error ? error.message : t('states.errorMessage'));
          }
        })(),
      },
    ]);
  }, [session, t]);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('profileFoundation.title')} />}>
        <StateView
          kind="unauthenticated"
          title={t('profileFoundation.guestTitle')}
          message={t('profileFoundation.guestMessage')}
          actionLabel={t('common.signIn')}
          onAction={() => void requireAuth({ action: 'SENSITIVE_ACCOUNT_CHANGE', returnTo: '/(tabs)/profile' })}
        />
      </ScreenShell>
    );
  }

  if (loading) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('profileFoundation.title')} />}>
        <StateView kind="loading" title={t('states.loading')} message={t('states.loadingMessage')} />
      </ScreenShell>
    );
  }

  if (loadError) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('profileFoundation.title')} />}>
        <StateView
          kind={loadError}
          title={t(loadError === 'offline' ? 'states.offline' : 'states.error')}
          message={t(loadError === 'offline' ? 'states.offlineMessage' : 'states.errorMessage')}
          actionLabel={t('states.retry')}
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  return (
    <ScreenShell header={<AppBar title={t('profileFoundation.title')} subtitle={profile?.mobile ?? user.phone ?? undefined} />} testID="profile-screen">
      <SectionHeader title={t('profileFoundation.account')} />
      <View style={styles.stack}>
        {profileRows.map((row) => (
          <View key={row.label} style={[styles.rowCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.flex}>
              <ThemedText style={styles.label}>{row.label}</ThemedText>
              <ThemedText themeColor="textSecondary">{row.value}</ThemedText>
            </View>
            <StatusBadge label={t(row.complete ? 'profileFoundation.complete' : 'profileFoundation.incomplete')} tone={row.complete ? 'success' : 'warning'} />
          </View>
        ))}
        <TextInput value={profileName} onChangeText={setProfileName} placeholder="Your name" placeholderTextColor={theme.textSecondary} style={inputStyle} accessibilityLabel="Profile name" />
        <TextInput value={profileEmail} onChangeText={setProfileEmail} placeholder="Email (optional)" placeholderTextColor={theme.textSecondary} autoCapitalize="none" keyboardType="email-address" style={inputStyle} accessibilityLabel="Profile email" />
        <PrimaryAction label="Save profile" onPress={() => void saveProfile()} loading={savingProfile} />
      </View>

      <SectionHeader title={t('profileFoundation.myPets')} actionLabel={showPetForm ? t('common.cancel') : t('profileFoundation.addPet')} onAction={() => showPetForm ? setShowPetForm(false) : startPet()} />
      <View style={styles.stack}>
        {pets.length === 0 ? (
          <StateView kind="empty" title={t('profileFoundation.petsEmpty')} message={t('profileFoundation.petsEmptyMessage')} />
        ) : (
          <View style={styles.petGrid}>
            {pets.map((pet) => (
              <View key={pet.petId} style={[styles.petCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <View style={[styles.petAvatar, { backgroundColor: theme.primarySoft }]}><AppIcon name="paw" color={theme.primary} size={28} /></View>
                <ThemedText style={styles.petName} numberOfLines={1}>{pet.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{[pet.species, pet.breed].filter(Boolean).join(' · ')}</ThemedText>
                <View style={styles.smallActions}>
                  <Pressable onPress={() => startPet(pet)} accessibilityRole="button" accessibilityLabel={`Edit ${pet.name}`} style={styles.textAction}><ThemedText type="smallBold" style={{ color: theme.primary }}>Edit</ThemedText></Pressable>
                  <Pressable onPress={() => removePet(pet)} accessibilityRole="button" accessibilityLabel={`Remove ${pet.name}`} style={styles.textAction}><ThemedText type="smallBold" style={{ color: theme.danger }}>Remove</ThemedText></Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {showPetForm ? (
          <View style={[styles.formCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <TextInput value={petDraft.name} onChangeText={(name) => setPetDraft((current) => ({ ...current, name }))} placeholder={t('profileFoundation.petNamePlaceholder')} placeholderTextColor={theme.textSecondary} style={inputStyle} accessibilityLabel={t('profileFoundation.petName')} />
            <View style={styles.speciesRow}>
              {(['DOG', 'CAT', 'OTHER'] as const).map((species) => {
                const selected = petDraft.species === species;
                return (
                  <Pressable key={species} onPress={() => setPetDraft((current) => ({ ...current, species }))} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.speciesChip, { backgroundColor: selected ? theme.primarySoft : theme.backgroundElement, borderColor: selected ? theme.primary : theme.border }]}>
                    <ThemedText type="smallBold" style={{ color: selected ? theme.primary : theme.text }}>{species}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <TextInput value={petDraft.breed} onChangeText={(breed) => setPetDraft((current) => ({ ...current, breed }))} placeholder={t('profileFoundation.breedOptional')} placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={petDraft.dateOfBirth} onChangeText={(dateOfBirth) => setPetDraft((current) => ({ ...current, dateOfBirth }))} placeholder="Date of birth YYYY-MM-DD (optional)" placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <PrimaryAction label={petDraft.petId ? 'Update pet' : t('profileFoundation.savePet')} onPress={() => void savePet()} loading={savingPet} />
          </View>
        ) : null}
      </View>

      <SectionHeader title={t('profileFoundation.deliveryAddress')} actionLabel={showAddressForm ? t('common.cancel') : 'Add address'} onAction={() => showAddressForm ? setShowAddressForm(false) : startAddress()} />
      <View style={styles.stack}>
        {addresses.length === 0 ? (
          <StateView kind="empty" title="No saved addresses" message="Add an address now so it is ready for delivery and future bookings." />
        ) : addresses.map((address) => (
          <View key={address.addressId} style={[styles.addressCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.addressHeading}>
              <View style={styles.flex}>
                <ThemedText type="smallBold">{address.label}</ThemedText>
                <ThemedText>{address.recipientName}</ThemedText>
              </View>
              {address.isDefault ? <StatusBadge label="Default" tone="success" /> : null}
            </View>
            <ThemedText themeColor="textSecondary">{address.line1}{address.line2 ? `, ${address.line2}` : ''}</ThemedText>
            <ThemedText themeColor="textSecondary">{address.city}, {address.state} · {address.pincode}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{address.phoneNumber}</ThemedText>
            <View style={styles.smallActions}>
              <Pressable onPress={() => startAddress(address)} accessibilityRole="button" style={styles.textAction}><ThemedText type="smallBold" style={{ color: theme.primary }}>Edit</ThemedText></Pressable>
              <Pressable onPress={() => removeAddress(address)} accessibilityRole="button" style={styles.textAction}><ThemedText type="smallBold" style={{ color: theme.danger }}>Delete</ThemedText></Pressable>
              {!address.isDefault ? (
                <Pressable onPress={() => {
                  setAddressDraft({
                    addressId: address.addressId,
                    label: address.label,
                    recipientName: address.recipientName,
                    phoneNumber: address.phoneNumber,
                    line1: address.line1,
                    line2: address.line2 ?? '',
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode,
                    isDefault: true,
                  });
                  setShowAddressForm(true);
                }} accessibilityRole="button" style={styles.textAction}><ThemedText type="smallBold">Make default</ThemedText></Pressable>
              ) : null}
            </View>
          </View>
        ))}

        {showAddressForm ? (
          <View style={[styles.formCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">Precise GPS coordinates are not collected for saved addresses in P2. Delivery routing will request only the minimum location data needed in the delivery plan.</ThemedText>
            <TextInput value={addressDraft.label} onChangeText={(label) => setAddressDraft((current) => ({ ...current, label }))} placeholder={t('profileFoundation.addressLabel')} placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={addressDraft.recipientName} onChangeText={(recipientName) => setAddressDraft((current) => ({ ...current, recipientName }))} placeholder="Recipient name" placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={addressDraft.phoneNumber} onChangeText={(phoneNumber) => setAddressDraft((current) => ({ ...current, phoneNumber }))} placeholder={t('profileFoundation.deliveryContactPlaceholder')} placeholderTextColor={theme.textSecondary} keyboardType="phone-pad" style={inputStyle} />
            <TextInput value={addressDraft.line1} onChangeText={(line1) => setAddressDraft((current) => ({ ...current, line1 }))} placeholder={t('profileFoundation.line1')} placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={addressDraft.line2} onChangeText={(line2) => setAddressDraft((current) => ({ ...current, line2 }))} placeholder="Address line 2 (optional)" placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={addressDraft.city} onChangeText={(city) => setAddressDraft((current) => ({ ...current, city }))} placeholder={t('profileFoundation.city')} placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={addressDraft.state} onChangeText={(state) => setAddressDraft((current) => ({ ...current, state }))} placeholder={t('profileFoundation.state')} placeholderTextColor={theme.textSecondary} style={inputStyle} />
            <TextInput value={addressDraft.pincode} onChangeText={(pincode) => setAddressDraft((current) => ({ ...current, pincode }))} placeholder={t('profileFoundation.pincode')} placeholderTextColor={theme.textSecondary} keyboardType="number-pad" maxLength={6} style={inputStyle} />
            <Pressable onPress={() => setAddressDraft((current) => ({ ...current, isDefault: !current.isDefault }))} accessibilityRole="checkbox" accessibilityState={{ checked: addressDraft.isDefault }} style={[styles.checkboxRow, { borderColor: theme.border }]}>
              <AppIcon name={addressDraft.isDefault ? 'check' : 'circle'} size={20} color={addressDraft.isDefault ? theme.primary : theme.textSecondary} />
              <ThemedText>Use as default address</ThemedText>
            </Pressable>
            <PrimaryAction label={addressDraft.addressId ? 'Update address' : t('profileFoundation.saveAddress')} onPress={() => void saveAddress()} loading={savingAddress} />
          </View>
        ) : null}
      </View>

      <SectionHeader title={t('profileFoundation.language')} />
      <View style={styles.languages}>
        {LANGUAGES.map((language) => (
          <Pressable key={language.id} onPress={() => void changeLocale(language.id)} accessibilityRole="button" accessibilityState={{ selected: locale === language.id }} style={[styles.language, { backgroundColor: locale === language.id ? theme.primarySoft : theme.backgroundElement, borderColor: locale === language.id ? theme.primary : theme.border }]}>
            <ThemedText style={styles.label}>{language.label}</ThemedText>
            <AppIcon name="check" color={locale === language.id ? theme.primary : theme.border} />
          </Pressable>
        ))}
      </View>
      <PrimaryAction label="Loyalty wallet" onPress={() => router.push('/wallet' as never)} />
      <PrimaryAction label="Privacy Centre" onPress={() => router.push('/privacy' as never)} />
      <PrimaryAction label="Legal & policies" onPress={() => router.push('/legal' as never)} />
      <PrimaryAction label={t('common.signOut')} onPress={() => void signOut()} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.x3 },
  flex: { flex: 1 },
  rowCard: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  label: { ...typography.label },
  input: { width: '100%', minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, ...typography.body },
  petGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x3 },
  petCard: { width: '47%', minHeight: 160, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, alignItems: 'center', justifyContent: 'center', gap: spacing.x2 },
  petAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  petName: { ...typography.label, textAlign: 'center' },
  formCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  speciesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  speciesChip: { minHeight: touchTarget, minWidth: 84, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x3, alignItems: 'center', justifyContent: 'center' },
  smallActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2, justifyContent: 'center' },
  textAction: { minHeight: touchTarget, paddingHorizontal: spacing.x2, alignItems: 'center', justifyContent: 'center' },
  addressCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x2 },
  addressHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  checkboxRow: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x3, flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  languages: { gap: spacing.x2 },
  language: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
