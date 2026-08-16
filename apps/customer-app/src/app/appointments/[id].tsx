import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppIcon } from '@/components/app-icon';
import { AppBar, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import {
  cancelAppointment,
  fetchAppointmentDetails,
  type AppointmentPaymentStatus,
  type CustomerAppointmentRecord,
  type HistoryAppointmentStatus,
} from '@/services/customer-history';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { session } = useAuth();

  const [appt, setAppt] = useState<CustomerAppointmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !session) return;
    setLoading(true);
    fetchAppointmentDetails(id, session.accessToken)
      .then((data) => {
        setAppt(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || 'Could not load appointment details');
      })
      .finally(() => setLoading(false));
  }, [id, session]);

  const handleCancel = async () => {
    if (!appt || !session) return;
    try {
      await cancelAppointment(appt.id, 'Cancelled from appointment details', session.accessToken);
      Alert.alert(
        t('common.success'),
        appt.paymentMethod === 'ONLINE_PAYMENT' && appt.paymentStatus === 'PAID'
          ? 'Appointment cancelled. MyPet will start the refund workflow for the captured payment.'
          : 'Appointment cancelled successfully.',
      );
      router.back();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || 'Could not cancel appointment.');
    }
  };

  const openDirections = () => {
    if (!appt?.address) return;
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(appt.address)}`).catch(() => null);
  };

  const callProvider = () => {
    if (!appt?.providerPhone) return;
    Linking.openURL(`tel:${appt.providerPhone}`).catch(() => null);
  };

  const openPrescription = () => {
    if (!appt?.prescriptionDocUrl) return;
    Linking.openURL(appt.prescriptionDocUrl).catch(() => null);
  };

  return (
    <ScreenShell
      header={
        <AppBar
          title="Appointment Details"
          subtitle={`Ref #${id?.slice(0, 8)}`}
          action={
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <ThemedText style={{ color: theme.text, fontWeight: '700' }}>✕</ThemedText>
            </Pressable>
          }
        />
      }
    >
      {loading ? (
        <StateView kind="loading" title={t('states.loading')} message={t('states.loadingMessage')} />
      ) : error || !appt ? (
        <StateView
          kind="error"
          title={t('states.error')}
          message={error || 'Appointment not found'}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
        />
      ) : (
        <View style={styles.container}>
          {appt.status === 'PENDING_PROVIDER' ? (
            <View style={[styles.providerNotice, { backgroundColor: theme.primarySoft }]}>
              <ThemedText style={styles.providerNoticeTitle}>Waiting for provider confirmation</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Your request reached {appt.providerName}. This appointment becomes Confirmed only after the provider accepts it.
              </ThemedText>
            </View>
          ) : null}

          {appt.status === 'REJECTED' ? (
            <View style={[styles.providerNotice, { backgroundColor: theme.muted }]}>
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
            <View style={styles.infoRow}><AppIcon name="calendar" size={16} color={theme.primary} /><ThemedText style={styles.infoText}>Date & Time: {new Date(appt.slotStartsAt).toLocaleString()}</ThemedText></View>
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
            {appt.address ? <Pressable style={[styles.actionBtn, { backgroundColor: theme.primarySoft }]} onPress={openDirections}><AppIcon name="location" size={16} color={theme.primary} /><ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>Directions</ThemedText></Pressable> : null}
            {appt.providerPhone ? <Pressable style={[styles.actionBtn, { backgroundColor: theme.primarySoft }]} onPress={callProvider}><AppIcon name="sparkle" size={16} color={theme.primary} /><ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>Call Clinic</ThemedText></Pressable> : null}
          </View>

          {appt.prescriptionDocUrl ? (
            <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={styles.sectionTitle}>Medical Report & Prescription</ThemedText>
              <Pressable style={styles.docRow} onPress={openPrescription}><AppIcon name="medical" size={20} color={theme.primary} /><ThemedText style={styles.docText}>View Prescribed Medical Document</ThemedText></Pressable>
            </View>
          ) : null}

          {['SLOT_HELD', 'PENDING_PROVIDER', 'CONFIRMED'].includes(appt.status) ? (
            <View style={styles.actions}>
              <Pressable style={[styles.cancelBtn, { borderColor: theme.danger }]} onPress={() => void handleCancel()}>
                <ThemedText style={{ color: theme.danger, fontWeight: '700' }}>Cancel Appointment</ThemedText>
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
  backBtn: { padding: spacing.x2 },
  container: { padding: spacing.x4, gap: spacing.x4 },
  providerNotice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x1 },
  providerNoticeTitle: { ...typography.label, fontWeight: '800' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  providerName: { ...typography.title },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.x1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  paymentRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  infoText: { ...typography.body },
  sectionTitle: { ...typography.label },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, paddingVertical: spacing.x2 },
  docText: { ...typography.label, color: '#2563EB' },
  quickActions: { flexDirection: 'row', gap: spacing.x3 },
  actionBtn: { flex: 1, height: 44, borderRadius: radii.compact, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x2 },
  actionBtnText: { ...typography.label, fontWeight: '700' },
  actions: { marginTop: spacing.x2 },
  cancelBtn: { height: 48, borderWidth: 1, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
});
