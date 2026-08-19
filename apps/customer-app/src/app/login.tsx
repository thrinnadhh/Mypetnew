import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { parseAuthIntent } from '@/auth/auth-intent';
import { OtpAuthError, resendOtpCode, requestOtp, verifyOtpCode } from '@/auth/otp-auth';
import { AppBar, PrimaryAction } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { getOrCreateInstallationId } from '@/utils/installation-id';

type Step = 'identifier' | 'code';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ intent?: string; fresh?: string }>();
  const parsedIntent = useMemo(() => parseAuthIntent(params.intent), [params.intent]);
  const fresh = params.fresh === '1';
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const { markOtpVerified, setSession } = useAuth();
  const { clearPendingIntent, resumePendingIntent } = useAuthIntent();

  const [step, setStep] = useState<Step>('identifier');
  const [identifierInput, setIdentifierInput] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [adultEligibilityAttested, setAdultEligibilityAttested] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const flowGenerationRef = useRef(0);

  useEffect(() => {
    return () => {
      flowGenerationRef.current += 1;
      inFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const errorMessage = useMemo(() => {
    if (!errorCode) return null;
    const key: Record<string, string> = {
      INVALID_INPUT: 'auth.invalidInput',
      INVALID_CODE: 'auth.invalidCode',
      EXPIRED_CODE: 'auth.expiredCode',
      RATE_LIMITED: 'auth.rateLimited',
      NETWORK: 'auth.network',
      PROVIDER_UNAVAILABLE: 'auth.providerUnavailable',
      AUTHENTICATION_REQUIRED: 'auth.authenticationRequired',
      UNKNOWN: 'auth.unknown',
    };
    return t(key[errorCode] ?? 'auth.unknown');
  }, [errorCode, t]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setErrorCode(null);
    try {
      await operation();
    } catch (error) {
      if (error instanceof OtpAuthError && error.code === 'CANCELLED') return;
      setErrorCode(error instanceof OtpAuthError ? error.code : 'UNKNOWN');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const finish = useCallback(async () => {
    await resumePendingIntent(parsedIntent);
  }, [parsedIntent, resumePendingIntent]);

  const send = useCallback(() => run(async () => {
    const generation = flowGenerationRef.current;
    const deviceId = await getOrCreateInstallationId();
    const { mobile, challenge } = await requestOtp(identifierInput, deviceId);
    if (generation !== flowGenerationRef.current) return;
    setIdentifier(mobile);
    setChallengeId(challenge.challengeId);
    setCode('');
    setSeconds(challenge.resendAfterSeconds);
    setStep('code');
  }), [identifierInput, run]);

  const verify = useCallback(() => run(async () => {
    const generation = flowGenerationRef.current;
    const newSession = await verifyOtpCode(challengeId, identifier, code, adultEligibilityAttested);
    if (generation !== flowGenerationRef.current) return;
    await setSession(newSession);
    if (generation !== flowGenerationRef.current) return;
    markOtpVerified();
    await finish();
  }), [adultEligibilityAttested, challengeId, code, finish, identifier, markOtpVerified, run, setSession]);

  const resend = useCallback(() => run(async () => {
    if (seconds > 0) return;
    const generation = flowGenerationRef.current;
    const deviceId = await getOrCreateInstallationId();
    const challenge = await resendOtpCode(identifier, deviceId);
    if (generation !== flowGenerationRef.current) return;
    setChallengeId(challenge.challengeId);
    setSeconds(challenge.resendAfterSeconds);
  }), [identifier, run, seconds]);

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    flowGenerationRef.current += 1;
    setStep('identifier');
    setIdentifier('');
    setIdentifierInput('');
    setChallengeId('');
    setCode('');
    setAdultEligibilityAttested(false);
    setErrorCode(null);
    setSeconds(0);
  }, []);

  const cancel = useCallback(() => {
    if (inFlightRef.current) return;
    flowGenerationRef.current += 1;
    clearPendingIntent();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home' as never);
  }, [clearPendingIntent, router]);

  return (
    <ScreenShell
      header={<AppBar title={t(fresh ? 'auth.freshTitle' : 'auth.title')} subtitle={t('auth.subtitle')} />}
      testID="otp-auth-screen"
    >
      {step === 'identifier' ? (
        <View style={styles.stack}>
          <TextInput
            value={identifierInput}
            onChangeText={setIdentifierInput}
            placeholder={t('auth.phonePlaceholder')}
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityLabel={t('auth.phonePlaceholder')}
          />
          <PrimaryAction label={t('auth.sendCode')} onPress={() => void send()} loading={loading} />
        </View>
      ) : null}

      {step === 'code' ? (
        <View style={styles.stack}>
          <ThemedText style={styles.heading}>{t('auth.verifyTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('auth.verifySubtitle', { identifier })}</ThemedText>
          <TextInput
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('auth.codePlaceholder')}
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            style={[styles.input, styles.code, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityLabel={t('auth.codePlaceholder')}
          />
          <Pressable
            style={styles.attestation}
            onPress={() => setAdultEligibilityAttested((current) => !current)}
            disabled={loading}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: adultEligibilityAttested, disabled: loading }}
            accessibilityLabel={t('auth.adultEligibility')}
          >
            <View style={[styles.checkbox, { borderColor: theme.border, backgroundColor: adultEligibilityAttested ? theme.primary : theme.backgroundElement }]}>
              {adultEligibilityAttested ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
            </View>
            <ThemedText style={styles.attestationText}>{t('auth.adultEligibility')}</ThemedText>
          </Pressable>
          <PrimaryAction label={t('auth.verify')} onPress={() => void verify()} loading={loading} disabled={code.length !== 6 || !adultEligibilityAttested} />
          <Pressable
            style={styles.link}
            disabled={seconds > 0 || loading}
            onPress={() => void resend()}
            accessibilityRole="button"
            accessibilityState={{ disabled: seconds > 0 || loading }}
          >
            <ThemedText style={{ color: seconds > 0 ? theme.textSecondary : theme.primary, fontWeight: '700' }}>
              {seconds > 0 ? t('auth.resendIn', { seconds }) : t('auth.resend')}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.link} disabled={loading} onPress={reset} accessibilityRole="button" accessibilityState={{ disabled: loading }}>
            <ThemedText style={{ color: theme.primary }}>{t('auth.changeIdentifier')}</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {errorMessage ? (
        <View style={[styles.error, { backgroundColor: theme.errorSoft }]} accessibilityLiveRegion="assertive">
          <ThemedText style={{ color: theme.danger }}>{errorMessage}</ThemedText>
        </View>
      ) : null}
      {errorCode ? (
        <Pressable style={styles.link} disabled={loading} onPress={reset} accessibilityRole="button" accessibilityState={{ disabled: loading }}>
          <ThemedText style={{ color: theme.primary }}>{t('auth.recovery')}</ThemedText>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancel} disabled={loading} onPress={cancel} accessibilityRole="button" accessibilityState={{ disabled: loading }}>
        <ThemedText themeColor="textSecondary">{t('auth.cancel')}</ThemedText>
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.x4 },
  heading: { ...typography.title },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, ...typography.body },
  code: { fontSize: 26, letterSpacing: 8, textAlign: 'center' },
  attestation: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#FFFFFF', fontWeight: '800' },
  attestationText: { flex: 1 },
  link: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.x2 },
  error: { borderRadius: radii.compact, padding: spacing.x4 },
  cancel: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
