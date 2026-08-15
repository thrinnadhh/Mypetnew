import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppBar, PrimaryAction, SectionHeader, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  createPrivacyGrievance,
  createPrivacyRequest,
  deleteCustomerAccount,
  grantConsent,
  loadPrivacySummary,
  updatePrivacyProfile,
  withdrawConsent,
  type ConsentPurpose,
  type PersonalDataSummary,
} from '@/services/privacy';

const optionalPurposes: ReadonlyArray<{ purpose: ConsentPurpose; title: string; notice: string }> = [
  { purpose: 'LOCATION', title: 'Location', notice: 'Use foreground location to help select a delivery address. Precise location is not required for browsing.' },
  { purpose: 'NOTIFICATIONS', title: 'Notifications', notice: 'Register this device to receive minimal order and loyalty updates.' },
  { purpose: 'MARKETING', title: 'Marketing', notice: 'Receive optional MyPet offers. This is not required to use checkout.' },
  { purpose: 'PRODUCT_ANALYTICS', title: 'Product analytics', notice: 'Use pseudonymous interaction events to improve the app. Restricted fields are excluded.' },
  { purpose: 'PERSONALISATION', title: 'Personalisation', notice: 'Use your MyPet activity to personalise in-app content.' },
  { purpose: 'RECURRING_ORDER_REMINDERS', title: 'Recurring reminders', notice: 'Remind you to confirm a repeat order without creating an automatic purchase.' },
];

export default function PrivacyCentreScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { session, signOut } = useAuth();
  const [summary, setSummary] = useState<PersonalDataSummary | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [grievance, setGrievance] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const data = await loadPrivacySummary();
    setSummary(data);
    setDisplayName(data.profile.displayName ?? '');
    setEmail(data.profile.email ?? '');
  }, []);

  useEffect(() => {
    if (!session) return;
    void reload().catch(() => setStatus('Privacy information is temporarily unavailable.'));
  }, [reload, session]);

  const run = useCallback(async (
    action: () => Promise<void>,
    success: string,
    reloadAfter = true,
  ) => {
    if (!session) return;
    setBusy(true);
    try {
      await action();
      setStatus(success);
      if (reloadAfter) await reload();
    } catch {
      setStatus('The privacy request could not be completed. Try again later.');
    } finally {
      setBusy(false);
    }
  }, [reload, session]);

  const active = useMemo(
    () => new Set(summary?.activeConsents.map((consent) => consent.purpose) ?? []),
    [summary],
  );

  if (!session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Privacy Centre" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in required"
          message="Sign in to review your data or exercise privacy rights."
          actionLabel="Back to profile"
          onAction={() => router.replace('/(tabs)/profile' as never)}
        />
      </ScreenShell>
    );
  }

  const inputStyle = [styles.input, {
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    borderColor: theme.border,
  }];

  return (
    <ScreenShell header={<AppBar title="Privacy Centre" subtitle="Your data and choices" />} testID="privacy-centre-screen">
      <ThemedText themeColor="textSecondary">
        Review your data, control optional purposes, exercise privacy rights, or delete your account.
      </ThemedText>

      <SectionHeader title="Your account data" />
      {summary ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText>Mobile: {summary.mobileE164}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Account reference: {summary.customerId}</ThemedText>
          <TextInput accessibilityLabel="Display name" onChangeText={setDisplayName} placeholder="Display name" placeholderTextColor={theme.textSecondary} style={inputStyle} value={displayName} />
          <TextInput accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} placeholder="Email (optional)" placeholderTextColor={theme.textSecondary} style={inputStyle} value={email} />
          <PrimaryAction label="Correct or update profile" loading={busy} onPress={() => void run(() => updatePrivacyProfile(displayName, email), 'Profile updated.')} />
        </View>
      ) : <StateView kind="loading" title="Loading privacy information" />}

      <SectionHeader title="Optional purposes" />
      {optionalPurposes.map(({ purpose, title, notice }) => (
        <View key={purpose} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>{title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{notice}</ThemedText>
          <PrimaryAction
            label={active.has(purpose) ? 'Withdraw' : 'Allow'}
            disabled={busy}
            onPress={() => void run(
              () => (active.has(purpose) ? withdrawConsent(purpose) : grantConsent(purpose)).then(() => undefined),
              active.has(purpose) ? 'Consent withdrawn.' : 'Consent recorded.',
            )}
          />
        </View>
      ))}

      <SectionHeader title="Rights requests" />
      <View style={styles.actions}>
        <PrimaryAction label="Request access summary" disabled={busy} onPress={() => void run(() => createPrivacyRequest('ACCESS'), 'Access request recorded.')} />
        <PrimaryAction label="Request selective erasure" disabled={busy} onPress={() => void run(() => createPrivacyRequest('ERASURE'), 'Erasure request recorded for review.')} />
        <PrimaryAction label="Start nomination request" disabled={busy} onPress={() => void run(() => createPrivacyRequest('NOMINATION'), 'Nomination request recorded for review.')} />
      </View>

      <SectionHeader title="Privacy grievance" />
      <TextInput accessibilityLabel="Privacy grievance" multiline onChangeText={setGrievance} placeholder="Describe the issue without passwords, OTPs, or payment credentials." placeholderTextColor={theme.textSecondary} style={[inputStyle, styles.multiline]} value={grievance} />
      <PrimaryAction label="Raise grievance" disabled={busy || !grievance.trim()} onPress={() => void run(async () => { await createPrivacyGrievance(grievance); setGrievance(''); }, 'Grievance recorded.')} />

      <SectionHeader title="Delete account" />
      <ThemedText themeColor="textSecondary">
        Deletion signs you out everywhere, revokes notification delivery, erases profile and cart data, and pseudonymises legally retained records.
      </ThemedText>
      <TextInput accessibilityLabel="Type DELETE to confirm" autoCapitalize="characters" onChangeText={setDeleteConfirmation} placeholder="Type DELETE" placeholderTextColor={theme.textSecondary} style={inputStyle} value={deleteConfirmation} />
      <PrimaryAction
        label="Delete my account"
        disabled={busy || deleteConfirmation !== 'DELETE'}
        onPress={() => void run(async () => {
          await deleteCustomerAccount();
          await signOut();
          router.replace('/' as never);
        }, 'Account deleted and local session cleared.', false)}
      />

      {status ? <ThemedText accessibilityLiveRegion="polite">{status}</ThemedText> : null}
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ThemedText style={{ color: theme.primary, fontWeight: '700' }}>Back</ThemedText>
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  cardTitle: { ...typography.label },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, ...typography.body },
  multiline: { minHeight: 112, paddingVertical: spacing.x3, textAlignVertical: 'top' },
  actions: { gap: spacing.x3 },
  back: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
