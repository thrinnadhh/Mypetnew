import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { parseAuthIntent } from '@/auth/auth-intent';
import { signInWithGoogle } from '@/auth/google-auth';
import { type OtpChannel, OtpAuthError, resendOtp, sendOtp, verifyOtp } from '@/auth/otp-auth';
import { AppBar, PrimaryAction } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { syncCommunicationContact } from '@/services/communication-contact';
import { supabase } from '@/utils/supabase';

type Step = 'identifier' | 'code' | 'name';
const RESEND_SECONDS = 30;
const PHONE_CHANNEL: OtpChannel = 'phone';

async function syncContactBestEffort(accessToken: string) {
  try {
    await syncCommunicationContact(accessToken);
  } catch (error) {
    console.warn('Communication contact sync deferred:', error);
  }
}

export default function LoginScreen() {
  const params = useLocalSearchParams<{ intent?: string; fresh?: string }>();
  const parsedIntent = useMemo(() => parseAuthIntent(params.intent), [params.intent]);
  const fresh = params.fresh === '1';
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const { markOtpVerified } = useAuth();
  const { clearPendingIntent, resumePendingIntent } = useAuthIntent();
  const [step, setStep] = useState<Step>('identifier');
  const [identifierInput, setIdentifierInput] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

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
      UNKNOWN: 'auth.unknown',
    };
    return t(key[errorCode] ?? 'auth.unknown');
  }, [errorCode, t]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setLoading(true);
    setErrorCode(null);
    try {
      await operation();
    } catch (error) {
      if (error instanceof OtpAuthError && error.code === 'CANCELLED') return;
      setErrorCode(error instanceof OtpAuthError ? error.code : 'UNKNOWN');
    } finally {
      setLoading(false);
    }
  }, []);

  const finish = useCallback(async () => {
    await resumePendingIntent(parsedIntent);
  }, [parsedIntent, resumePendingIntent]);

  const googleSignIn = useCallback(() => run(async () => {
    let session = await signInWithGoogle();
    markOtpVerified();
    const metadata = session.user.user_metadata ?? {};
    const name = typeof metadata.full_name === 'string'
      ? metadata.full_name.trim()
      : typeof metadata.name === 'string'
        ? metadata.name.trim()
        : '';
    if (name) {
      if (metadata.full_name !== name) {
        const updated = await supabase.auth.updateUser({ data: { full_name: name, role: 'CUSTOMER' } });
        if (updated.error) throw updated.error;
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error && refreshed.data.session) session = refreshed.data.session;
      }
      await syncContactBestEffort(session.access_token);
      await finish();
      return;
    }
    await syncContactBestEffort(session.access_token);
    setStep('name');
  }), [finish, markOtpVerified, run]);

  const send = useCallback(() => run(async () => {
    const normalized = await sendOtp(PHONE_CHANNEL, identifierInput);
    setIdentifier(normalized);
    setCode('');
    setSeconds(RESEND_SECONDS);
    setStep('code');
  }), [identifierInput, run]);

  const verify = useCallback(() => run(async () => {
    const session = await verifyOtp(PHONE_CHANNEL, identifier, code);
    markOtpVerified();
    await syncContactBestEffort(session.access_token);
    const name = typeof session.user.user_metadata?.full_name === 'string'
      ? session.user.user_metadata.full_name.trim()
      : '';
    if (!name) setStep('name');
    else await finish();
  }), [code, finish, identifier, markOtpVerified, run]);

  const saveName = useCallback(() => run(async () => {
    const name = displayName.trim();
    if (name.length < 2) throw new OtpAuthError('INVALID_INPUT', 'Display name is required.');
    const { error } = await supabase.auth.updateUser({ data: { full_name: name, role: 'CUSTOMER' } });
    if (error) throw error;
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session) {
      await syncContactBestEffort(refreshed.data.session.access_token);
    }
    await finish();
  }), [displayName, finish, run]);

  const resend = useCallback(() => run(async () => {
    if (seconds > 0) return;
    await resendOtp(PHONE_CHANNEL, identifier);
    setSeconds(RESEND_SECONDS);
  }), [identifier, run, seconds]);

  const reset = useCallback(() => {
    setStep('identifier');
    setIdentifier('');
    setIdentifierInput('');
    setCode('');
    setErrorCode(null);
    setSeconds(0);
  }, []);

  const cancel = useCallback(() => {
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
          <PrimaryAction label={t('auth.continueGoogle')} onPress={() => void googleSignIn()} loading={loading} />
          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <ThemedText themeColor="textSecondary">{t('auth.orMobile')}</ThemedText>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
          </View>
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
          <PrimaryAction label={t('auth.verify')} onPress={() => void verify()} loading={loading} disabled={code.length !== 6} />
          <Pressable style={styles.link} disabled={seconds > 0 || loading} onPress={() => void resend()} accessibilityRole="button">
            <ThemedText style={{ color: seconds > 0 ? theme.textSecondary : theme.primary, fontWeight: '700' }}>
              {seconds > 0 ? t('auth.resendIn', { seconds }) : t('auth.resend')}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.link} onPress={reset} accessibilityRole="button">
            <ThemedText style={{ color: theme.primary }}>{t('auth.changeIdentifier')}</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {step === 'name' ? (
        <View style={styles.stack}>
          <ThemedText style={styles.heading}>{t('auth.nameTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('auth.nameSubtitle')}</ThemedText>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('auth.namePlaceholder')}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityLabel={t('auth.namePlaceholder')}
          />
          <PrimaryAction label={t('auth.saveName')} onPress={() => void saveName()} loading={loading} disabled={displayName.trim().length < 2} />
        </View>
      ) : null}

      {errorMessage ? (
        <View style={[styles.error, { backgroundColor: theme.errorSoft }]} accessibilityLiveRegion="assertive">
          <ThemedText style={{ color: theme.danger }}>{errorMessage}</ThemedText>
        </View>
      ) : null}
      {errorCode ? (
        <Pressable style={styles.link} onPress={reset} accessibilityRole="button">
          <ThemedText style={{ color: theme.primary }}>{t('auth.recovery')}</ThemedText>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancel} onPress={cancel} accessibilityRole="button">
        <ThemedText themeColor="textSecondary">{t('auth.cancel')}</ThemedText>
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.x4 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  divider: { height: 1, flex: 1 },
  heading: { ...typography.title },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x4, ...typography.body },
  code: { fontSize: 26, letterSpacing: 8, textAlign: 'center' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.x2 },
  error: { borderRadius: radii.compact, padding: spacing.x4 },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
