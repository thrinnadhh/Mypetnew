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
  createDefaultAddress,
  fetchDefaultAddress,
  fetchDeliveryContact,
  isOfflineError,
  normalizeDeliveryPhone,
  saveDeliveryContact,
  type AddressInput,
} from '@/services/customer-profile';

type AddressDraft = Record<keyof AddressInput, string>;
const emptyAddress: AddressDraft = { label: 'Home', line1: '', line2: '', city: 'Tirupati', state: 'Andhra Pradesh', pincode: '', geoLat: '', geoLng: '' };

export default function ProfileScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { user, session, signOut } = useAuth();
  const { requireAuth } = useAuthIntent();
  const { locale, changeLocale } = useLocale();
  const [address, setAddress] = useState<AddressDraft>(emptyAddress);
  const [hasAddress, setHasAddress] = useState(false);
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [addressError, setAddressError] = useState<'offline' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAddress = useCallback(async () => {
    if (!session) return;
    setLoadingAddress(true); setAddressError(null);
    try {
      const saved = await fetchDefaultAddress(session.access_token);
      setHasAddress(Boolean(saved));
      if (saved) {
        setAddress({
          label: saved.label ?? '', line1: saved.line1, line2: saved.line2 ?? '', city: saved.city, state: saved.state,
          pincode: saved.pincode, geoLat: String(saved.geoLat), geoLng: String(saved.geoLng),
        });
        const contact = await fetchDeliveryContact(session.access_token, saved.addressId);
        setDeliveryPhone(contact?.phoneNumber ?? user?.phone ?? '');
      } else {
        setDeliveryPhone(user?.phone ?? '');
      }
    } catch (error) { setAddressError(isOfflineError(error) ? 'offline' : 'error'); }
    finally { setLoadingAddress(false); }
  }, [session, user]);

  useEffect(() => {
    if (!user || !session) return;
    void loadAddress();
  }, [loadAddress, session, user]);

  const normalizedDeliveryPhone = useMemo(() => {
    if (!deliveryPhone.trim()) return null;
    try { return normalizeDeliveryPhone(deliveryPhone); }
    catch { return null; }
  }, [deliveryPhone]);

  const verifiedAuthPhone = useMemo(() => {
    if (!user?.phone || !user.phone_confirmed_at) return null;
    try { return normalizeDeliveryPhone(user.phone); }
    catch { return null; }
  }, [user]);

  const deliveryPhoneVerified = Boolean(
    normalizedDeliveryPhone && verifiedAuthPhone === normalizedDeliveryPhone,
  );

  const profileRows = useMemo(() => user ? [
    { label: t('profileFoundation.displayName'), value: String(user.user_metadata?.full_name ?? ''), complete: Boolean(user.user_metadata?.full_name) },
    { label: t('profileFoundation.verifiedMobile'), value: user.phone ?? '—', complete: Boolean(user.phone_confirmed_at) },
    { label: t('profileFoundation.deliveryContact'), value: normalizedDeliveryPhone ?? '—', complete: Boolean(normalizedDeliveryPhone) },
    { label: t('profileFoundation.emailOptional'), value: user.email ?? '—', complete: true },
  ] : [], [normalizedDeliveryPhone, t, user]);

  const save = useCallback(async () => {
    if (!user || !session) return;
    const input: AddressInput = {
      label: address.label.trim(), line1: address.line1.trim(), line2: address.line2.trim(), city: address.city.trim(), state: address.state.trim(), pincode: address.pincode.trim(),
      geoLat: Number(address.geoLat), geoLng: Number(address.geoLng),
    };
    if (!input.line1 || !input.city || !input.state || !/^\d{6}$/.test(input.pincode) || !Number.isFinite(input.geoLat) || !Number.isFinite(input.geoLng)) {
      Alert.alert(t('common.error'), t('profileFoundation.addressRequired')); return;
    }
    if (!normalizedDeliveryPhone) {
      Alert.alert(t('common.error'), t('profileFoundation.deliveryContactRequired')); return;
    }

    setSaving(true);
    try {
      const savedAddress = await createDefaultAddress(session.access_token, input);
      await saveDeliveryContact(session.access_token, savedAddress.addressId, normalizedDeliveryPhone);
      setDeliveryPhone(normalizedDeliveryPhone);
      setHasAddress(true);
      Alert.alert(t('common.success'), t('profileFoundation.addressAndContactSaved'));
    } catch (error) {
      Alert.alert(
        t('common.error'),
        isOfflineError(error)
          ? t('states.offlineMessage')
          : error instanceof Error ? error.message : t('states.errorMessage'),
      );
    } finally {
      setSaving(false);
    }
  }, [address, normalizedDeliveryPhone, session, t, user]);

  if (!user || !session) return (
    <ScreenShell scroll={false} header={<AppBar title={t('profileFoundation.title')} />}>
      <StateView kind="unauthenticated" title={t('profileFoundation.guestTitle')} message={t('profileFoundation.guestMessage')} actionLabel={t('common.signIn')} onAction={() => void requireAuth({ action: 'SENSITIVE_ACCOUNT_CHANGE', returnTo: '/(tabs)/profile' })} />
    </ScreenShell>
  );

  const field = (key: keyof AddressDraft, label: string, keyboardType: 'default' | 'number-pad' | 'decimal-pad' = 'default') => (
    <TextInput key={key} value={address[key]} onChangeText={(value) => setAddress((current) => ({ ...current, [key]: value }))} placeholder={label} placeholderTextColor={theme.textSecondary} keyboardType={keyboardType} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]} accessibilityLabel={label} />
  );

  return (
    <ScreenShell header={<AppBar title={t('profileFoundation.title')} subtitle={user.email ?? user.phone ?? undefined} />} testID="profile-screen">
      <SectionHeader title={t('profileFoundation.account')} />
      <View style={styles.stack}>{profileRows.map((row) => <View key={row.label} style={[styles.rowCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><View style={styles.flex}><ThemedText style={styles.label}>{row.label}</ThemedText><ThemedText themeColor="textSecondary">{row.value}</ThemedText></View><StatusBadge label={t(row.complete ? 'profileFoundation.complete' : 'profileFoundation.incomplete')} tone={row.complete ? 'success' : 'warning'} /></View>)}</View>

      <SectionHeader title={t('profileFoundation.deliveryAddress')} />
      {loadingAddress ? <StateView kind="loading" title={t('states.loading')} /> : null}
      {addressError ? <StateView kind={addressError} title={t(addressError === 'offline' ? 'states.offline' : 'states.error')} message={t(addressError === 'offline' ? 'states.offlineMessage' : 'states.errorMessage')} actionLabel={t('states.retry')} onAction={() => void loadAddress()} /> : null}
      {!loadingAddress && !addressError ? (
        <View style={styles.stack}>
          <ThemedText themeColor="textSecondary">{t('profileFoundation.deliveryContactMessage')}</ThemedText>
          <TextInput
            value={deliveryPhone}
            onChangeText={setDeliveryPhone}
            placeholder={t('profileFoundation.deliveryContactPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityLabel={t('profileFoundation.deliveryContact')}
          />
          <StatusBadge
            label={t(deliveryPhoneVerified ? 'profileFoundation.contactVerifiedByAuth' : 'profileFoundation.contactCustomerProvided')}
            tone={deliveryPhoneVerified ? 'success' : 'neutral'}
          />
          {field('label', t('profileFoundation.addressLabel'))}
          {field('line1', t('profileFoundation.line1'))}
          {field('city', t('profileFoundation.city'))}
          {field('state', t('profileFoundation.state'))}
          {field('pincode', t('profileFoundation.pincode'), 'number-pad')}
          <View style={styles.inline}>{field('geoLat', t('profileFoundation.latitude'), 'decimal-pad')}{field('geoLng', t('profileFoundation.longitude'), 'decimal-pad')}</View>
          <PrimaryAction label={t('profileFoundation.saveAddress')} onPress={() => void save()} loading={saving} />
        </View>
      ) : null}
      <SectionHeader title={t('profileFoundation.language')} />
      <View style={styles.languages}>{LANGUAGES.map((language) => <Pressable key={language.id} onPress={() => void changeLocale(language.id)} accessibilityRole="button" accessibilityState={{ selected: locale === language.id }} style={[styles.language, { backgroundColor: locale === language.id ? theme.primarySoft : theme.backgroundElement, borderColor: locale === language.id ? theme.primary : theme.border }]}><ThemedText style={styles.label}>{language.label}</ThemedText><AppIcon name="check" color={locale === language.id ? theme.primary : theme.border} /></Pressable>)}</View>
      <PrimaryAction label={t('common.signOut')} onPress={() => void signOut()} />
      <ThemedText type="small" themeColor="textSecondary">{hasAddress ? t('profileFoundation.complete') : t('profileFoundation.incomplete')}</ThemedText>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.x3 }, flex: { flex: 1 },
  rowCard: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  label: { ...typography.label },
  input: { flex: 1, minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, ...typography.body },
  inline: { flexDirection: 'row', gap: spacing.x2 },
  languages: { gap: spacing.x2 },
  language: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
