import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchOnboardingDraft, saveOnboardingDraft } from '../../api/onboarding';
import { Button } from '../../components/Button';
import { palette, radii, spacing, typography } from '../../design/tokens';

export default function ConsentScreen() {
  const [agreement, setAgreement] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [location, setLocation] = useState(false);
  const [safety, setSafety] = useState(false);
  const [settlement, setSettlement] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOnboardingDraft().then((draft) => {
      if (draft.consent) {
        setAgreement(draft.consent.captainAgreementAccepted || false);
        setPrivacy(draft.consent.privacyPolicyAccepted || false);
        setLocation(draft.consent.locationUsageAccepted || false);
        setSafety(draft.consent.safetyPolicyAccepted || false);
        setSettlement(draft.consent.settlementTermsAccepted || false);
      }
    });
  }, []);

  const allAccepted = agreement && privacy && location && safety && settlement;

  const handleSave = async () => {
    setError(null);
    if (!allAccepted) {
      setError('Please accept all policies and agreements to proceed');
      return;
    }

    setSaving(true);
    try {
      await saveOnboardingDraft({
        consent: {
          captainAgreementAccepted: agreement,
          privacyPolicyAccepted: privacy,
          locationUsageAccepted: location,
          safetyPolicyAccepted: safety,
          settlementTermsAccepted: settlement,
        },
        stepCompleted: Math.max(6, 6),
      });
      router.push('/onboarding/review');
    } catch {
      setError('Failed to save consent agreements. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const policies = [
    {
      title: 'Captain Partner Agreement',
      description: 'Terms governing your engagement as an independent delivery partner with MyPet.',
      checked: agreement,
      toggle: () => setAgreement(!agreement),
    },
    {
      title: 'Privacy & Customer Data Protection',
      description: 'Agreement to keep all customer addresses, contact details, and order info strictly confidential.',
      checked: privacy,
      toggle: () => setPrivacy(!privacy),
    },
    {
      title: 'Location & Tracking Policy',
      description: 'Permission to publish GPS location while online to allocate nearby orders and route customer deliveries.',
      checked: location,
      toggle: () => setLocation(!location),
    },
    {
      title: 'Delivery Safety & Pet Handling Guidelines',
      description: 'Standard operating procedures for safe road transit and secure pet food/healthcare delivery.',
      checked: safety,
      toggle: () => setSafety(!safety),
    },
    {
      title: 'Payout & Settlement Terms',
      description: 'Weekly payout schedule, deduction policies, and bank verification rules.',
      checked: settlement,
      toggle: () => setSettlement(!settlement),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.stepIndicator}>STEP 6 OF 6</Text>
        <Text style={styles.title}>Policies & Agreement</Text>
        <Text style={styles.subtitle}>
          Please read and accept the partner terms and operating guidelines.
        </Text>

        <View style={styles.policyList}>
          {policies.map((p) => (
            <TouchableOpacity
              key={p.title}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: p.checked }}
              activeOpacity={0.8}
              onPress={p.toggle}
              style={styles.policyCard}
            >
              <View style={[styles.checkbox, p.checked && styles.checkboxChecked]}>
                {p.checked ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={styles.policyInfo}>
                <Text style={styles.policyTitle}>{p.title}</Text>
                <Text style={styles.policyDesc}>{p.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.actionRow}>
          <Button
            disabled={!allAccepted || saving}
            loading={saving}
            onPress={handleSave}
            title="Agree & Review"
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
  stepIndicator: {
    ...typography.caption,
    color: palette.royalBlue,
    letterSpacing: 1,
    marginBottom: 2,
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
  policyList: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  policyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.outlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    borderColor: palette.royalBlue,
    backgroundColor: palette.royalBlue,
  },
  checkmark: {
    color: palette.white,
    fontWeight: '800',
    fontSize: 14,
  },
  policyInfo: {
    flex: 1,
  },
  policyTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  policyDesc: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  errorText: {
    ...typography.caption,
    color: palette.error,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  actionRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
});
