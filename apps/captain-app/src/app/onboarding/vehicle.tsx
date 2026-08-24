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

export default function VehicleDetailsScreen() {
  const [vehicleType, setVehicleType] = useState<'BIKE' | 'SCOOTER'>('BIKE');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [model, setModel] = useState('');
  const [colour, setColour] = useState('');
  const [rcUploaded, setRcUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOnboardingDraft().then((draft) => {
      if (draft.vehicle) {
        setVehicleType(draft.vehicle.vehicleType || 'BIKE');
        setRegistrationNumber(draft.vehicle.registrationNumber || '');
        setModel(draft.vehicle.model || '');
        setColour(draft.vehicle.colour || '');
        setRcUploaded(draft.vehicle.rcUploaded || false);
      }
    });
  }, []);

  const handleSave = async () => {
    setError(null);
    if (!registrationNumber.trim()) {
      setError('Please enter your vehicle registration number');
      return;
    }

    setSaving(true);
    try {
      await saveOnboardingDraft({
        vehicle: {
          vehicleType,
          registrationNumber: registrationNumber.trim().toUpperCase(),
          model: model.trim(),
          colour: colour.trim(),
          rcUploaded,
        },
        stepCompleted: Math.max(3, 3),
      });
      router.push('/onboarding/bank');
    } catch {
      setError('Failed to save vehicle details. Please try again.');
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
          <Text style={styles.stepIndicator}>STEP 3 OF 6</Text>
          <Text style={styles.title}>Vehicle Information</Text>
          <Text style={styles.subtitle}>
            Enter details of the vehicle you will use for delivery fulfillment.
          </Text>

          <Text style={styles.fieldLabel}>Vehicle Type</Text>
          <View style={styles.typeRow}>
            {(['BIKE', 'SCOOTER'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                accessibilityRole="button"
                onPress={() => setVehicleType(type)}
                style={[
                  styles.typeButton,
                  vehicleType === type && styles.typeButtonSelected,
                ]}
              >
                <Text
                  style={[
                    styles.typeText,
                    vehicleType === type && styles.typeTextSelected,
                  ]}
                >
                  {type === 'BIKE' ? '🏍️ Motorcycle / Bike' : '🛵 Scooter'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            autoCapitalize="characters"
            error={error}
            label="Registration Number"
            onChangeText={setRegistrationNumber}
            placeholder="e.g. KA 01 AB 1234"
            value={registrationNumber}
          />

          <Input
            label="Vehicle Model"
            onChangeText={setModel}
            placeholder="e.g. Hero Splendor Plus"
            value={model}
          />

          <Input
            label="Vehicle Colour"
            onChangeText={setColour}
            placeholder="e.g. Black / Blue"
            value={colour}
          />

          <View style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>Vehicle Registration Certificate (RC)</Text>
            <Text style={styles.uploadSubtitle}>
              Upload a clear photo of your RC document.
            </Text>
            <Button
              onPress={() => setRcUploaded(!rcUploaded)}
              style={styles.uploadBtn}
              title={rcUploaded ? '✓ RC Document Uploaded (Tap to replace)' : 'Upload RC Photo'}
              variant={rcUploaded ? 'secondary' : 'outline'}
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
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  typeButton: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    backgroundColor: palette.white,
    alignItems: 'center',
  },
  typeButtonSelected: {
    borderColor: palette.royalBlue,
    backgroundColor: palette.royalBlueSoft,
  },
  typeText: {
    ...typography.label,
    color: palette.inkMuted,
  },
  typeTextSelected: {
    color: palette.royalBlue,
    fontWeight: '700',
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
