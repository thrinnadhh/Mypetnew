import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { bypassMerchantLoginForDemo, requestMerchantOtp, verifyMerchantOtp } from '../src/auth/session';
import { palette, radii, spacing, touchTarget, typography } from '../src/design/tokens';

function displayError(error: unknown): string {
  if (error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message))) {
    return 'Unable to reach MyPet. Check your connection and try again.';
  }
  if (!(error instanceof Error)) return 'Unable to continue';
  switch (error.message) {
    case 'MOBILE_INVALID':
      return 'Enter a valid Indian mobile number (+91...).';
    case 'OTP_INVALID':
      return 'The verification code is invalid or expired.';
    case 'OTP_RATE_LIMITED':
      return 'Too many attempts. Try again later.';
    case 'SESSION_INVALID':
      return 'This mobile number is not authorized for an active Merchant account.';
    default:
      return 'Unable to continue. Try again.';
  }
}

export default function MerchantLoginScreen() {
  const [mobile, setMobile] = useState('+91');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const normalizedMobile = mobile.trim();
  const canRequest = /^\+91[6-9][0-9]{9}$/.test(normalizedMobile);
  const canVerify = challengeId !== null && /^[0-9]{6}$/.test(code.trim());

  async function continueLogin() {
    if (busy || (!challengeId && !canRequest) || (challengeId && !canVerify)) return;
    setBusy(true);
    setMessage('');
    try {
      if (!challengeId) {
        const challenge = await requestMerchantOtp(normalizedMobile);
        setChallengeId(challenge.challengeId);
        setMessage(challenge.message);
        return;
      }
      await verifyMerchantOtp(challengeId, normalizedMobile, code.trim());
      router.replace('/(tabs)');
    } catch (error) {
      setMessage(displayError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDemoBypass() {
    setBusy(true);
    try {
      await bypassMerchantLoginForDemo();
      router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  }

  function changeMobile() {
    if (busy) return;
    setChallengeId(null);
    setCode('');
    setMessage('');
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.brandHeader}>
          <Text style={styles.brandIcon}>🐾</Text>
          <Text style={styles.title}>MyPet Merchant</Text>
          <Text style={styles.subtitle}>Sign in to access your store POS & operational dashboard</Text>
        </View>

        {/* 1-Tap Demo Mode Banner */}
        <Pressable
          style={styles.demoBanner}
          onPress={() => void handleDemoBypass()}
          accessibilityRole="button"
        >
          <View style={styles.demoBannerContent}>
            <Text style={styles.demoIcon}>⚡</Text>
            <View style={styles.demoTextGroup}>
              <Text style={styles.demoTitle}>Instant Demo Mode (1-Tap Bypass)</Text>
              <Text style={styles.demoSubtitle}>Preview all screens with pre-loaded mock data</Text>
            </View>
          </View>
          <Text style={styles.demoArrow}>→</Text>
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or sign in with mobile</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Merchant Mobile Number</Text>
          <TextInput
            accessibilityLabel="Merchant mobile number"
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={!busy && !challengeId}
            value={mobile}
            onChangeText={setMobile}
            style={styles.input}
            placeholder="+91 98765 43210"
          />
        </View>

        {challengeId ? (
          <View style={styles.formGroup}>
            <Text style={styles.label}>6-Digit Verification Code</Text>
            <TextInput
              accessibilityLabel="Verification code"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              editable={!busy}
              value={code}
              onChangeText={setCode}
              style={[styles.input, styles.codeInput]}
              placeholder="123456"
              autoFocus
            />
            <Pressable onPress={changeMobile} disabled={busy} style={styles.changeBtn}>
              <Text style={styles.changeText}>Use a different mobile number</Text>
            </Pressable>
          </View>
        ) : null}

        {message ? (
          <View style={styles.alertBox}>
            <Text accessibilityRole="alert" style={styles.alertText}>
              {message}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[
            styles.submitButton,
            (busy || (!challengeId && !canRequest) || Boolean(challengeId && !canVerify)) &&
              styles.submitButtonDisabled,
          ]}
          disabled={busy || (!challengeId && !canRequest) || Boolean(challengeId && !canVerify)}
          onPress={() => void continueLogin()}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={palette.white} />
          ) : (
            <Text style={styles.submitText}>
              {challengeId ? 'Verify & Continue' : 'Send Verification Code'}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
    justifyContent: 'center',
    padding: spacing.x4,
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    padding: spacing.x5,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.x3,
  },
  brandHeader: {
    alignItems: 'center',
    gap: spacing.x1,
    marginBottom: spacing.x1,
  },
  brandIcon: {
    fontSize: 36,
  },
  title: {
    ...typography.display,
    fontSize: 22,
    color: palette.ink,
  },
  subtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    textAlign: 'center',
  },
  demoBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: palette.royalBlue,
    borderRadius: radii.compact,
    padding: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  demoBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    flex: 1,
  },
  demoIcon: {
    fontSize: 22,
  },
  demoTextGroup: {
    flex: 1,
  },
  demoTitle: {
    ...typography.label,
    color: palette.royalBlue,
    fontWeight: '700',
  },
  demoSubtitle: {
    ...typography.caption,
    color: '#3B82F6',
  },
  demoArrow: {
    fontSize: 20,
    color: palette.royalBlue,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginVertical: spacing.x1,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: palette.outlineSoft,
  },
  dividerText: {
    ...typography.caption,
    color: palette.inkMuted,
  },
  formGroup: {
    gap: spacing.x1,
  },
  label: {
    ...typography.label,
    color: palette.ink,
  },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.x3,
    backgroundColor: palette.coolWhite,
    ...typography.body,
    color: palette.ink,
  },
  codeInput: {
    letterSpacing: 8,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  changeBtn: {
    paddingVertical: spacing.x1,
  },
  changeText: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '600',
  },
  alertBox: {
    padding: spacing.x3,
    borderRadius: radii.compact,
    backgroundColor: palette.amberSoft,
  },
  alertText: {
    ...typography.bodySmall,
    color: '#92400E',
    textAlign: 'center',
  },
  submitButton: {
    minHeight: 48,
    backgroundColor: palette.royalBlue,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.x1,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitText: {
    ...typography.title,
    fontSize: 15,
    color: palette.white,
  },
});
