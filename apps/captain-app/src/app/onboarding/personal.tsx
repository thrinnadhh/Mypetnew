import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchOnboardingDraft, saveOnboardingDraft } from '../../api/onboarding';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { palette, spacing, typography } from '../../design/tokens';
import { isValidPinCode } from '../../utils/validation';

export default function PersonalDetailsScreen() {
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOnboardingDraft().then((draft) => {
      if (draft.personal) {
        setFullName(draft.personal.fullName || '');
        setDob(draft.personal.dob || '');
        setEmergencyContact(draft.personal.emergencyContact || '');
        setAddress(draft.personal.address || '');
        setCity(draft.personal.city || '');
        setPincode(draft.personal.pincode || '');
      }
    });
  }, []);

  const handleSave = async () => {
    setError(null);
    if (!fullName.trim()) {
      setError('Please enter your full legal name');
      return;
    }
    if (!pincode.trim() || !isValidPinCode(pincode)) {
      setError('Please enter a valid 6-digit PIN code');
      return;
    }

    setSaving(true);
    try {
      await saveOnboardingDraft({
        personal: {
          fullName: fullName.trim(),
          dob: dob.trim(),
          emergencyContact: emergencyContact.trim(),
          address: address.trim(),
          city: city.trim(),
          pincode: pincode.trim(),
        },
        stepCompleted: Math.max(1, 1),
      });
      router.push('/onboarding/identity');
    } catch {
      setError('Failed to save personal details. Please try again.');
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
          <Text style={styles.stepIndicator}>STEP 1 OF 6</Text>
          <Text style={styles.title}>Personal Information</Text>
          <Text style={styles.subtitle}>
            Enter your personal details as they appear on your government identity.
          </Text>

          <Input
            error={error}
            label="Full Name"
            onChangeText={setFullName}
            placeholder="e.g. Ramesh Kumar"
            value={fullName}
          />

          <Input
            label="Date of Birth (DD/MM/YYYY)"
            onChangeText={setDob}
            placeholder="DD/MM/YYYY"
            value={dob}
          />

          <Input
            keyboardType="phone-pad"
            label="Emergency Contact Phone"
            maxLength={10}
            onChangeText={setEmergencyContact}
            placeholder="98765 43210"
            value={emergencyContact}
          />

          <Input
            label="Residential Address"
            multiline
            numberOfLines={3}
            onChangeText={setAddress}
            placeholder="Street address, building, flat number"
            value={address}
          />

          <Input
            label="City"
            onChangeText={setCity}
            placeholder="e.g. Bengaluru"
            value={city}
          />

          <Input
            keyboardType="number-pad"
            label="PIN Code"
            maxLength={6}
            onChangeText={setPincode}
            placeholder="560001"
            value={pincode}
          />

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
  actionRow: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
