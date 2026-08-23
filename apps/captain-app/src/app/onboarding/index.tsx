import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchOnboardingDraft, OnboardingDraft } from '../../api/onboarding';
import { Button } from '../../components/Button';
import { palette, radii, spacing, typography } from '../../design/tokens';

export default function OnboardingHomeScreen() {
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);

  useEffect(() => {
    fetchOnboardingDraft().then(setDraft);
  }, []);

  const steps = [
    { title: 'Personal Details', route: '/onboarding/personal', completed: !!draft?.personal?.fullName },
    { title: 'Identity & License', route: '/onboarding/identity', completed: !!draft?.identity?.drivingLicenseNumber },
    { title: 'Vehicle Information', route: '/onboarding/vehicle', completed: !!draft?.vehicle?.registrationNumber },
    { title: 'Bank Details', route: '/onboarding/bank', completed: !!draft?.bank?.accountNumber },
    { title: 'Documents Checklist', route: '/onboarding/documents', completed: !!draft?.identity?.licenseUploaded },
    { title: 'Policies & Consent', route: '/onboarding/consent', completed: !!draft?.consent?.captainAgreementAccepted },
  ];

  const completedCount = steps.filter((s) => s.completed).length;

  const getNextIncompleteStep = () => {
    const next = steps.find((s) => !s.completed);
    return next ? next.route : '/onboarding/review';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Complete your Captain profile</Text>
          <Text style={styles.subtitle}>
            {completedCount} of {steps.length} steps completed
          </Text>

          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${(completedCount / steps.length) * 100}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.stepList}>
          {steps.map((step, idx) => (
            <TouchableOpacity
              key={step.title}
              accessibilityRole="button"
              onPress={() => router.push(step.route as any)}
              style={styles.stepItem}
            >
              <View
                style={[
                  styles.stepIconContainer,
                  step.completed && styles.stepIconCompleted,
                ]}
              >
                <Text style={styles.stepIconText}>
                  {step.completed ? '✓' : idx + 1}
                </Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepStatus}>
                  {step.completed ? 'Completed' : 'Pending'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Button
          onPress={() => router.push(getNextIncompleteStep() as any)}
          style={styles.continueBtn}
          title={completedCount === steps.length ? 'Review & Submit' : 'Continue Application'}
          variant="primary"
        />
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
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.body,
    color: palette.inkMuted,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  progressBar: {
    height: 8,
    backgroundColor: palette.outlineSoft,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: palette.royalBlue,
    borderRadius: 4,
  },
  stepList: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  stepIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.outlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepIconCompleted: {
    backgroundColor: palette.emerald,
  },
  stepIconText: {
    ...typography.label,
    color: palette.white,
    fontWeight: '700',
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  stepStatus: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  chevron: {
    fontSize: 24,
    color: palette.inkMuted,
  },
  continueBtn: {
    marginTop: spacing.md,
  },
});
