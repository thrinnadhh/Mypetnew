import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchOnboardingDraft, saveOnboardingDraft } from '../../api/onboarding';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { palette, radii, spacing, typography } from '../../design/tokens';

export default function IdentityKycScreen() {
  const [identityType, setIdentityType] = useState<'AADHAAR' | 'PAN' | 'PASSPORT'>('AADHAAR');
  const [identityNumber, setIdentityNumber] = useState('');
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [licenseUploaded, setLicenseUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOnboardingDraft().then((draft) => {
      if (draft.identity) {
        setIdentityType(draft.identity.identityType || 'AADHAAR');
        setIdentityNumber(draft.identity.identityNumber || '');
        setDrivingLicenseNumber(draft.identity.drivingLicenseNumber || '');
        setLicenseExpiry(draft.identity.licenseExpiry || '');
        setLicenseUploaded(draft.identity.licenseUploaded || false);
      }
    });
  }, []);

  const handleSave = async () => {
    setError(null);
    if (!drivingLicenseNumber.trim()) {
      setError('Please enter your Driving License number');
      return;
    }

    setSaving(true);
    try {
      await saveOnboardingDraft({
        identity: {
          identityType,
          identityNumber: identityNumber.trim(),
          drivingLicenseNumber: drivingLicenseNumber.trim(),
          licenseExpiry: licenseExpiry.trim(),
          licenseUploaded,
        },
        stepCompleted: Math.max(2, 2),
      });
      router.push('/onboarding/vehicle');
    } catch {
      setError('Failed to save identity details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.stepIndicator}>STEP 2 OF 6</Text>
          <Text style={styles.title}>Identity & KYC</Text>
          <Text style={styles.subtitle}>
            Upload your government identity and commercial driving license.
          </Text>

          <Text style={styles.fieldLabel}>Select Identity Document Type</Text>
          <View style={styles.idTypeRow}>
            {(['AADHAAR', 'PAN', 'PASSPORT'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                accessibilityRole="button"
                onPress={() => setIdentityType(type)}
                style={[
                  styles.idTypeButton,
                  identityType === type && styles.idTypeButtonSelected,
                ]}
              >
                <Text
                  style={[
                    styles.idTypeText,
                    identityType === type && styles.idTypeTextSelected,
                  ]}
                >
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label={`${identityType} Number`}
            onChangeText={setIdentityNumber}
            placeholder={`Enter your ${identityType} number`}
            value={identityNumber}
          />

          <Input
            error={error}
            label="Driving License Number"
            onChangeText={setDrivingLicenseNumber}
            placeholder="e.g. KA01 20200012345"
            value={drivingLicenseNumber}
          />

          <Input
            label="License Expiry Date (DD/MM/YYYY)"
            onChangeText={setLicenseExpiry}
            placeholder="DD/MM/YYYY"
            value={licenseExpiry}
          />

          <View style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>Driving License Photo</Text>
            <Text style={styles.uploadSubtitle}>
              Ensure all text and license photo are clearly legible.
            </Text>
            <Button
              onPress={() => setLicenseUploaded(!licenseUploaded)}
              style={styles.uploadBtn}
              title={licenseUploaded ? '✓ Document Uploaded (Tap to replace)' : 'Upload License Front & Back'}
              variant={licenseUploaded ? 'secondary' : 'outline'}
            />
          </View>

          <View style={styles.actionRow}>
            <Button
              loading={saving}
              onPress={handleSave}
              title="Save & Continue"
              variant="primary"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  keyboardView: {
    flex: 1,
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
  fieldLabel: {
    ...typography.label,
    color: palette.ink,
    marginBottom: spacing.xs,
  },
  idTypeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  idTypeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    backgroundColor: palette.white,
    alignItems: 'center',
  },
  idTypeButtonSelected: {
    borderColor: palette.royalBlue,
    backgroundColor: palette.royalBlueSoft,
  },
  idTypeText: {
    ...typography.caption,
    color: palette.inkMuted,
    fontWeight: '700',
  },
  idTypeTextSelected: {
    color: palette.royalBlue,
  },
  uploadCard: {
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    marginVertical: spacing.md,
  },
  uploadTitle: {
    ...typography.label,
    color: palette.ink,
  },
  uploadSubtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  uploadBtn: {
    marginTop: spacing.xs,
  },
  actionRow: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
