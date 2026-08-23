import { router } from 'expo-router';
import React, { useState } from 'react';
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
import { requestCaptainOtp } from '../../api/auth';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { getFriendlyErrorMessage } from '../../utils/errors';
import { isValidIndianMobile } from '../../utils/validation';

export default function LoginScreen() {
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testPilots = [
    { label: 'Captain Ravi (Active Pilot)', phone: '9876543210' },
    { label: 'Captain Priya (New Pilot)', phone: '9123456789' },
  ];

  const handleContinue = async (overridePhone?: string) => {
    const targetPhone = overridePhone || mobile;
    setError(null);
    if (!isValidIndianMobile(targetPhone)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    setLoading(true);
    try {
      const response = await requestCaptainOtp(targetPhone);
      router.push({
        pathname: '/auth/otp',
        params: {
          challengeId: response.challengeId,
          mobile: targetPhone.trim(),
        },
      });
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTestPilot = (phone: string) => {
    setMobile(phone);
    handleContinue(phone);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoIcon}>🐾</Text>
            </View>
            <Text style={styles.brandTitle}>MyPet Captain</Text>
            <Text style={styles.subtitle}>Deliver with MyPet</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Enter your mobile number</Text>
            <Text style={styles.formSubtitle}>
              We will send you a one-time verification code (OTP).
            </Text>

            <Input
              autoFocus={!mobile}
              error={error}
              keyboardType="phone-pad"
              label="Mobile Number"
              leftElement={<Text style={styles.countryCode}>+91</Text>}
              maxLength={10}
              onChangeText={(val) => {
                setMobile(val.replace(/\D/g, ''));
                if (error) setError(null);
              }}
              placeholder="98765 43210"
              value={mobile}
            />

            <Button
              disabled={mobile.length < 10 || loading}
              loading={loading}
              onPress={() => handleContinue()}
              style={styles.continueBtn}
              title="Continue"
              variant="primary"
            />

            {/* Test Pilot / Quick Demo Section */}
            <View style={styles.testPilotSection}>
              <View style={styles.testPilotDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>⚡ QUICK TEST PILOT</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.pilotGrid}>
                {testPilots.map((pilot) => (
                  <TouchableOpacity
                    key={pilot.phone}
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => handleSelectTestPilot(pilot.phone)}
                    style={styles.pilotChip}
                  >
                    <Text style={styles.pilotIcon}>🛵</Text>
                    <View style={styles.pilotInfo}>
                      <Text style={styles.pilotLabel}>{pilot.label}</Text>
                      <Text style={styles.pilotPhone}>+91 {pilot.phone}</Text>
                    </View>
                    <Text style={styles.pilotArrow}>→</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <Text style={styles.termsText}>
              By continuing, you agree to the MyPet Captain Partner Terms of Service and Privacy Policy.
            </Text>
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
  scrollContent: {
    flexGrow: 1,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  logoIcon: {
    fontSize: 32,
  },
  brandTitle: {
    ...typography.display,
    color: palette.royalBlue,
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.title,
    color: palette.inkMuted,
    fontSize: 16,
    marginTop: 2,
  },
  formCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.xl,
  },
  formTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
  },
  formSubtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  countryCode: {
    ...typography.body,
    color: palette.ink,
    fontWeight: '700',
  },
  continueBtn: {
    marginTop: spacing.sm,
  },
  testPilotSection: {
    marginTop: spacing.xl,
  },
  testPilotDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: palette.outlineSoft,
  },
  dividerText: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  pilotGrid: {
    gap: spacing.sm,
  },
  pilotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.royalBlueSoft,
    borderWidth: 1,
    borderColor: '#C7D9FE',
    borderRadius: radii.compact,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  pilotIcon: {
    fontSize: 20,
  },
  pilotInfo: {
    flex: 1,
  },
  pilotLabel: {
    ...typography.label,
    color: palette.royalBlue,
    fontWeight: '700',
    fontSize: 13,
  },
  pilotPhone: {
    ...typography.caption,
    color: palette.inkMuted,
    fontSize: 12,
  },
  pilotArrow: {
    color: palette.royalBlue,
    fontSize: 16,
    fontWeight: '700',
  },
  termsText: {
    ...typography.caption,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 16,
  },
});
