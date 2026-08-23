import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchOnboardingDraft } from '../../api/onboarding';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';

export default function DocumentsScreen() {
  const [draft, setDraft] = useState<any>(null);

  useEffect(() => {
    fetchOnboardingDraft().then(setDraft);
  }, []);

  const documents = [
    {
      name: 'Driving Licence',
      status: draft?.identity?.licenseUploaded ? 'Uploaded' : 'Missing',
      variant: draft?.identity?.licenseUploaded ? ('active' as const) : ('error' as const),
      route: '/onboarding/identity',
    },
    {
      name: 'Vehicle RC',
      status: draft?.vehicle?.rcUploaded ? 'Uploaded' : 'Missing',
      variant: draft?.vehicle?.rcUploaded ? ('active' as const) : ('error' as const),
      route: '/onboarding/vehicle',
    },
    {
      name: 'Identity Proof',
      status: draft?.identity?.identityNumber ? 'Verified' : 'Missing',
      variant: draft?.identity?.identityNumber ? ('active' as const) : ('error' as const),
      route: '/onboarding/identity',
    },
    {
      name: 'Bank Passbook / Cheque',
      status: draft?.bank?.accountNumber ? 'Configured' : 'Missing',
      variant: draft?.bank?.accountNumber ? ('active' as const) : ('error' as const),
      route: '/onboarding/bank',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.stepIndicator}>STEP 5 OF 6</Text>
        <Text style={styles.title}>Required Documents</Text>
        <Text style={styles.subtitle}>
          Verify that all required compliance documents are uploaded and valid.
        </Text>

        <View style={styles.docList}>
          {documents.map((doc) => (
            <View key={doc.name} style={styles.docCard}>
              <View style={styles.docInfo}>
                <Text style={styles.docName}>{doc.name}</Text>
                <Text style={styles.docNote}>Mandatory for Captain activation</Text>
              </View>
              <StatusBadge label={doc.status} variant={doc.variant} />
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Button
            onPress={() => router.push('/onboarding/consent')}
            title="Continue to Agreement"
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
  docList: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  docInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  docName: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  docNote: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  actionRow: {
    marginTop: spacing.md,
  },
});
