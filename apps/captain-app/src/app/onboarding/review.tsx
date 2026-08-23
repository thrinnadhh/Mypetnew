import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchOnboardingDraft,
  OnboardingDraft,
  submitOnboardingApplication,
} from '../../api/onboarding';
import { useAuth } from '../../auth/context';
import { Button } from '../../components/Button';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { getFriendlyErrorMessage } from '../../utils/errors';

export default function OnboardingReviewScreen() {
  const { refreshProfile } = useAuth();
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOnboardingDraft().then(setDraft);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await submitOnboardingApplication();
      await refreshProfile();
      router.replace('/onboarding/status');
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const maskedBank = draft?.bank?.accountNumber
    ? `••••••••${draft.bank.accountNumber.slice(-4)}`
    : '—';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Review & Submit</Text>
        <Text style={styles.subtitle}>
          Review all information before submitting your Captain application for verification.
        </Text>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Personal Details</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/onboarding/personal')}
            >
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.valueText}>{draft?.personal?.fullName || '—'}</Text>
          <Text style={styles.subValueText}>
            {draft?.personal?.address}, {draft?.personal?.city} - {draft?.personal?.pincode}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Identity & Driving License</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/onboarding/identity')}
            >
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.valueText}>
            DL: {draft?.identity?.drivingLicenseNumber || '—'}
          </Text>
          <Text style={styles.subValueText}>
            {draft?.identity?.identityType}: {draft?.identity?.identityNumber || '—'}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Vehicle Information</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/onboarding/vehicle')}
            >
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.valueText}>
            {draft?.vehicle?.vehicleType}: {draft?.vehicle?.registrationNumber || '—'}
          </Text>
          <Text style={styles.subValueText}>
            Model: {draft?.vehicle?.model || '—'} ({draft?.vehicle?.colour || '—'})
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Bank Account</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/onboarding/bank')}
            >
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.valueText}>{draft?.bank?.accountHolder || '—'}</Text>
          <Text style={styles.subValueText}>
            A/C: {maskedBank} • IFSC: {draft?.bank?.ifsc || '—'}
          </Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.actionRow}>
          <Button
            loading={submitting}
            onPress={handleSubmit}
            title="Submit for Verification"
            variant="primary"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginBottom: spacing.lg,
  },
  sectionCard: {
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  editLink: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  valueText: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
  },
  subValueText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
  },
  errorText: {
    ...typography.caption,
    color: palette.error,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  actionRow: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
