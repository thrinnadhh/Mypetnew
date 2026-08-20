import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppIcon } from '@/components/app-icon';
import { AppBar, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { apiClient } from '@/services/api-client';
import {
  cancelAppointment,
  fetchAppointmentDetails,
  type AppointmentPaymentStatus,
  type CustomerAppointmentRecord,
  type HistoryAppointmentStatus,
} from '@/services/customer-history';
import {
  backOrReplace,
  formatIndiaDateTime,
  isSafeHttpsUrl,
  safeTelephoneUrl,
  singleRouteParam,
} from '@/utils/customer-navigation-safety';
import { isUuid } from '@/utils/uuid';

type DetailErrorKind = 'invalid' | 'error';

type AccountSnapshot = {
  userId: string;
  accessToken: string;
  authEpoch: number;
};

function statusLabel(status: HistoryAppointmentStatus): string {
  switch (status) {
    case 'PENDING_PROVIDER': return 'WAITING FOR PROVIDER';
    case 'REJECTED': return 'PROVIDER DECLINED';
    case 'SLOT_HELD': return 'SLOT HELD';
    default: return status.replaceAll('_', ' ');
  }
}

function paymentLabel(appt: CustomerAppointmentRecord): string {
  if (appt.paymentMethod === 'PAY_AT_PROVIDER') return 'Pay at provider';
  const labels: Record<AppointmentPaymentStatus, string> = {
    NOT_REQUIRED: 'No online payment required',
    PENDING: 'Online payment pending',
    PAID: 'Paid online',
    FAILED: 'Online payment failed',
    EXPIRED: 'Online payment expired',
    REFUND_PENDING: 'Refund in progress',
    REFUNDED: 'Refund completed',
    REFUND_FAILED: 'Refund needs support',
  };
  return labels[appt.paymentStatus];
}

function paymentTone(appt: CustomerAppointmentRecord): 'success' | 'warning' | 'error' | 'neutral' {
  if (appt.paymentMethod === 'PAY_AT_PROVIDER') return 'neutral';
  if (appt.paymentStatus === 'PAID' || appt.paymentStatus === 'REFUNDED') return 'success';
  if (appt.paymentStatus === 'FAILED' || appt.paymentStatus === 'EXPIRED' || appt.paymentStatus === 'REFUND_FAILED') return 'error';
  return 'warning';
}

export default function AppointmentDetailRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = singleRouteParam(params.id);
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();

  const [appt, setAppt] = useState<CustomerAppointmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<DetailErrorKind>('error');
  const [cancelling, setCancelling] = useState(false);
  const requestGenerationRef = useRef(0);
  const cancelInFlightRef = useRef(false);

  const accountSnapshot = useCallback((): AccountSnapshot | null => {
    if (!user?.id || !session?.accessToken) return null;
    return { userId: user.id, accessToken: session.accessToken, authEpoch: apiClient.getAuthEpoch() };
  }, [session, user]);

  const accountStillCurrent = useCallback((captured: AccountSnapshot) => (
    user?.id === captured.userId
    && session?.accessToken === captured.accessToken
    && apiClient.getAuthEpoch() === captured.authEpoch
  ), [session, user]);

  const handleBack = useCallback(() => {
    backOrReplace(router, '/appointments');
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack()) return false;
      router.replace('/appointments' as never);
      return true;
    });
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    setAppt(null);
    setError(null);
    cancelInFlightRef.current = false;
    setCancelling(false);

    const captured = accountSnapshot();
    if (!captured) {
      setLoading(false);
      return () => { requestGenerationRef.current += 1; };
    }
    if (!isUuid(id)) {
      setError('This appointment link is invalid.');
      setErrorKind('invalid');
      setLoading(false);
      return () => { requestGenerationRef.current += 1; };
    }

    const current = () => generation === requestGenerationRef.current && accountStillCurrent(captured);
    setLoading(true);
    void fetchAppointmentDetails(id, captured.accessToken)
      .then((data) => {
        if (!current()) return;
        setAppt(data);
        setError(null);
      })
      .catch((cause) => {
        if (!current()) return;
        setError(cause instanceof Error && cause.message ? cause.message : 'Could not load appointment details');
        setErrorKind('error');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });

    return () => { requestGenerationRef.current += 1; };
  }, [accountSnapshot, accountStillCurrent, id]);

  const performCancel = useCallback(async () => {
    if (!appt || cancelInFlightRef.current) return;
    const captured = accountSnapshot();
    if (!captured) return;
    cancelInFlightRef.current = true;
    setCancelling(true);
    try {
      await cancelAppointment(appt.id, 'Cancelled from appointment details', captured.accessToken);
      if (!accountStillCurrent(captured)) return;
      Alert.alert(
        t('common.success'),
        appt.paymentMethod === 'ONLINE_PAYMENT' && appt.paymentStatus === 'PAID'
          ? 'Appointment cancelled. MyPet will start the refund workflow for the captured payment.'
          : 'Appointment cancelled successfully.',
        [{ text: t('common.back'), onPress: handleBack }],
      );
    } catch (cause) {
      if (!accountStillCurrent(captured)) return;
      Alert.alert(t('common.error'), cause instanceof Error && cause.message ? cause.message : 'Could not cancel appointment.');
    } finally {
      cancelInFlightRef.current = false;
      if (accountStillCurrent(captured)) setCancelling(false);
    }
  }, [accountSnapshot, accountStillCurrent, appt, handleBack, t]);

  const confirmCancel = useCallback(() => {
    if (!appt || cancelling || cancelInFlightRef.current) return;
    Alert.alert(
      'Cancel appointment?',
      `Cancel ${appt.serviceName} with ${appt.providerName}? The server will determine the final cancellation and refund state.`,
      [
        { text: 'Keep appointment', style: 'cancel' },
        { text: 'Cancel appointment', style: 'destructive', onPress: () => void performCancel() },
      ],
    );
  }, [appt, cancelling, performCancel]);

  const openDirections = useCallback(async () => {
    if (!appt?.address) return;
    const url = `https://maps.google.com/?q=${encodeURIComponent(appt.address)}`;
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Directions unavailable', 'This device could not open directions for the provider address.');
    }
  }, [appt]);

  const callProvider = useCallback(async () => {
    const url = safeTelephoneUrl(appt?.providerPhone);
    if (!url) {
      Alert.alert('Phone number unavailable', 'The provider phone number is missing or invalid.');
      return;
    }
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Calling unavailable', 'This device could not open the phone dialer.');
    }
  }, [appt]);

  const openPrescription = useCallback(async () => {
    const url = appt?.prescriptionDocUrl;
    if (!isSafeHttpsUrl(url)) {
      Alert.alert('Document unavailable', 'The medical document link is missing or invalid.');
      return;
    }
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Document unavailable', 'This device could not open the medical document.');
    }
  }, [appt]);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment Details" />}>
        <StateView
          kind="unauthenticated"
          title={t('states.unauthenticated')}
          message="Sign in to view server-authoritative appointment details."
          actionLabel={t('common.signIn')}
          onAction={() => void requireAuth({ action: 'ORDER_HISTORY', returnTo: '/appointments' })}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      header={
        <AppBar
          title="Appointment Details"
          subtitle={id ? `Ref #${id.slice(0, 8)}` : undefined}
          action={
            <Pressable
              onPress={handleBack}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Close appointment details"
            >
              <ThemedText style={{ color: theme.text, fontWeight: '700' }}>✕</ThemedText>
            </Pressable>
          }
        />
      }
    >
      {loading ? (
        <StateView kind="loading" title={t('states.loading')} message="Loading the current appointment from MyPet…" />
      ) : error || !appt ? (
        <StateView
          kind="error"
          title={errorKind === 'invalid' ? 'Appointment link invalid' : t('states.error')}
          message={error || 'Appointment not found'}
          actionLabel="Back to appointments"
          onAction={handleBack}
        />
      ) : (
        <View style={styles.container}>
          {appt.status === 'PENDING_PROVIDER' ? (
            <View style={[styles.providerNotice, { backgroundColor: theme.primarySoft }]} accessible accessibilityLabel="Waiting for provider confirmation">
              <ThemedText style={styles.providerNoticeTitle}>Waiting for provider confirmation</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Your request reached {appt.providerName}. This appointment becomes Confirmed only after the provider accepts it.
              </ThemedText>
            </View>
          ) : null}

          {appt.status === 'REJECTED' ? (
            <View style={[styles.providerNotice, { backgroundColor: theme.muted }]} accessible accessibilityLabel="Provider declined this request">
              <ThemedText style={styles.providerNoticeTitle}>Provider declined this request</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {appt.paymentMethod === 'ONLINE_PAYMENT' && ['PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'].includes(appt.paymentStatus)
                  ? `The slot was released. Payment status: ${paymentLabel(appt)}.`
                  : 'This slot is no longer reserved for this request. Choose another available slot to book again.'}
              </ThemedText>
            </View>
          ) : null}

          <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.headerRow}>
              <View style={styles.flex}>
                <ThemedText style={styles.providerName}>{appt.providerName}</ThemedText>
                <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>{appt.serviceName}</ThemedText>
              </View>
              <StatusBadge
                label={statusLabel(appt.status)}
                tone={
                  appt.status === 'CONFIRMED' || appt.status === 'COMPLETED'
                    ? 'success'
                    : appt.status === 'CANCELLED' || appt.status === 'REJECTED' || appt.status === 'EXPIRED'
                      ? 'error'
                      : 'warning'
                }
              />
            </View>

            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.infoRow}><AppIcon name="paw" size={16} color={theme.primary} /><ThemedText style={styles.infoText}>Pet: {appt.petName}</ThemedText></View>
            <View style={styles.infoRow}><AppIcon name="calendar" size={16} color={theme.primary} /><ThemedText style={styles.infoText}>Date & Time: {formatIndiaDateTime(appt.slotStartsAt)}</ThemedText></View>
            {appt.address ? <View style={styles.infoRow}><AppIcon name="location" size={16} color={theme.primary} /><ThemedText style={styles.infoText}>Clinic: {appt.address}</ThemedText></View> : null}
            {appt.priceAmount ? <View style={styles.infoRow}><AppIcon name="sparkle" size={16} color={theme.primary} /><ThemedText style={styles.infoText}>Fee: ₹{appt.priceAmount}</ThemedText></View> : null}
            <View style={styles.infoRow}>
              <AppIcon name="sparkle" size={16} color={theme.primary} />
              <View style={styles.paymentRow}>
                <ThemedText style={styles.infoText}>Payment</ThemedText>
                <StatusBadge label={paymentLabel(appt)} tone={paymentTone(appt)} />
              </View>
            </View>
          </View>

          <View style={styles.quickActions}>
            {appt.address ? (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: theme.primarySoft }]}
                onPress={() => void openDirections()}
                accessibilityRole="button"
                accessibilityLabel={`Directions to ${appt.providerName}`}
                accessibilityHint="Opens the provider address in your maps app"
              >
                <AppIcon name="location" size={16} color={theme.primary} />
                <ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>Directions</ThemedText>
              </Pressable>
            ) : null}
            {appt.providerPhone ? (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: theme.primarySoft }]}
                onPress={() => void callProvider()}
                accessibilityRole="button"
                accessibilityLabel={`Call ${appt.providerName}`}
                accessibilityHint="Opens the phone dialer"
              >
                <AppIcon name="phone" size={16} color={theme.primary} />
                <ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>Call Provider</ThemedText>
              </Pressable>
            ) : null}
          </View>

          {appt.prescriptionDocUrl ? (
            <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={styles.sectionTitle}>Medical Report & Prescription</ThemedText>
              <Pressable
                style={styles.docRow}
                onPress={() => void openPrescription()}
                accessibilityRole="link"
                accessibilityLabel="View prescribed medical document"
              >
                <AppIcon name="medical" size={20} color={theme.primary} />
                <ThemedText style={styles.docText}>View Prescribed Medical Document</ThemedText>
              </Pressable>
            </View>
          ) : null}

          {['SLOT_HELD', 'PENDING_PROVIDER', 'CONFIRMED'].includes(appt.status) ? (
            <View style={styles.actions}>
              <Pressable
                style={[styles.cancelBtn, { borderColor: theme.danger }, cancelling && styles.disabled]}
                onPress={confirmCancel}
                disabled={cancelling}
                accessibilityRole="button"
                accessibilityLabel={cancelling ? 'Cancelling appointment' : 'Cancel appointment'}
                accessibilityHint="Asks for confirmation before cancelling"
                accessibilityState={{ disabled: cancelling, busy: cancelling }}
              >
                <ThemedText style={{ color: theme.danger, fontWeight: '700' }}>{cancelling ? 'Cancelling…' : 'Cancel Appointment'}</ThemedText>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backBtn: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.x4, gap: spacing.x4 },
  providerNotice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1 },
  providerNoticeTitle: { ...typography.label, fontWeight: '800' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  providerName: { ...typography.title },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.x1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  paymentRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  infoText: { ...typography.body, flexShrink: 1 },
  sectionTitle: { ...typography.label },
  docRow: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x2 },
  docText: { ...typography.label, color: '#2563EB', flexShrink: 1 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x3 },
  actionBtn: { flexGrow: 1, minWidth: 140, minHeight: touchTarget, borderRadius: radii.compact, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x2, paddingHorizontal: spacing.x3 },
  actionBtnText: { ...typography.label, fontWeight: '700' },
  actions: { marginTop: spacing.x2 },
  cancelBtn: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.x3 },
  disabled: { opacity: 0.55 },
});
