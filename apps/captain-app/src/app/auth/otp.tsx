import { router, useLocalSearchParams } from 'expo-router';
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
import { requestCaptainOtp, verifyCaptainOtp } from '../../api/auth';
import { useAuth } from '../../auth/context';
import { Button } from '../../components/Button';
import { ProofCodeInput } from '../../components/ProofCodeInput';
import { palette, spacing, typography } from '../../design/tokens';
import { getFriendlyErrorMessage } from '../../utils/errors';

export default function OtpVerificationScreen() {
  const { challengeId, mobile } = useLocalSearchParams<{ challengeId: string; mobile: string }>();
  const { loginSession } = useAuth();

  const [currentChallengeId, setCurrentChallengeId] = useState(challengeId || '');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleVerify = async () => {
    setError(null);
    if (!code || code.length < 4) {
      setError('Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      const session = await verifyCaptainOtp(currentChallengeId, mobile || '', code);
      await loginSession(session);
      router.replace('/');
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;
    setError(null);
    setResending(true);
    try {
      const response = await requestCaptainOtp(mobile || '');
      setCurrentChallengeId(response.challengeId);
      setCountdown(30);
      setCode('');
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const formattedPhone = mobile
    ? `+91 ${mobile.replace(/\D/g, '').slice(-10).replace(/(\d{5})(\d{5})/, '$1 $2')}`
    : '+91 —';

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
            <Text style={styles.title}>Verify your number</Text>
            <Text style={styles.subtitle}>
              We sent a verification code to{' '}
              <Text style={styles.phoneHighlight}>{formattedPhone}</Text>
            </Text>
          </View>

          <View style={styles.card}>
            <ProofCodeInput
              error={error}
              instructions="Enter the code sent to your phone"
              label=""
              length={6}
              onChange={(val) => {
                setCode(val);
                if (error) setError(null);
              }}
              value={code}
            />

            <Button
              disabled={code.length < 4 || loading}
              loading={loading}
              onPress={handleVerify}
              style={styles.verifyBtn}
              title="Verify Code"
              variant="primary"
            />

            {/* Test Helper Quick Fill */}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setCode('123456');
                if (error) setError(null);
              }}
              style={styles.quickFillBtn}
            >
              <Text style={styles.quickFillText}>⚡ Quick Fill Test OTP: 123456</Text>
            </TouchableOpacity>

            <View style={styles.resendContainer}>
              {countdown > 0 ? (
                <Text style={styles.countdownText}>
                  Resend code in <Text style={styles.countdownBold}>{countdown}s</Text>
                </Text>
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={resending}
                  onPress={handleResend}
                >
                  <Text style={styles.resendText}>
                    {resending ? 'Sending…' : 'Resend OTP'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.changeNumberBtn}
            >
              <Text style={styles.changeNumberText}>Change Mobile Number</Text>
            </TouchableOpacity>
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
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.body,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  phoneHighlight: {
    color: palette.ink,
    fontWeight: '700',
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.xl,
    alignItems: 'center',
  },
  verifyBtn: {
    marginTop: spacing.md,
  },
  quickFillBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.royalBlueSoft,
    borderRadius: 8,
  },
  quickFillText: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '700',
  },
  resendContainer: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  countdownText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
  },
  countdownBold: {
    color: palette.ink,
    fontWeight: '700',
  },
  resendText: {
    ...typography.label,
    color: palette.royalBlue,
    fontWeight: '700',
  },
  changeNumberBtn: {
    marginTop: spacing.md,
    padding: spacing.xs,
  },
  changeNumberText: {
    ...typography.caption,
    color: palette.inkMuted,
    textDecorationLine: 'underline',
  },
});
