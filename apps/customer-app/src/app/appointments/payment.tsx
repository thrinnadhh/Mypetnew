import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { confirmAppointmentHold, type AppointmentPaymentMethod } from '@/services/appointment-booking';
import { fetchAppointmentDetails, type CustomerAppointmentRecord } from '@/services/customer-history';
import {
  fetchPaymentStatus,
  initiateAppointmentPayment,
  loadPendingAppointmentPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
  type CustomerPaymentView,
  type PendingAppointmentPaymentRecovery,
} from '@/services/customer-payments';
import { appConfig } from '@/utils/app-config';

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function money(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function formatInstant(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export default function AppointmentPaymentScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const router = useRouter();
  const theme = useTheme();
  const { user, session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<PendingAppointmentPaymentRecovery | null>(null);
  const [appointment, setAppointment] = useState<CustomerAppointmentRecord | null>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [appointmentError, setAppointmentError] = useState<string | null>(null);

  const appointmentId = single(params.appointmentId);
  const demoAppointment = appConfig.allowDemoMode && appointmentId.startsWith('demo-appointment-');
  const routePaymentMethod: AppointmentPaymentMethod = single(params.paymentMethod) === 'PAY_AT_PROVIDER'
    ? 'PAY_AT_PROVIDER'
    : 'ONLINE_PAYMENT';
  const routeAmount = useMemo(() => {
    const parsed = Number(single(params.amount));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [params.amount]);

  useEffect(() => {
    if (!session || !appointmentId || demoAppointment) {
      setAppointment(null);
      setAppointmentLoading(false);
      setAppointmentError(null);
      return;
    }
    let active = true;
    setAppointmentLoading(true);
    setAppointmentError(null);
    void fetchAppointmentDetails(appointmentId, session.accessToken)
      .then((value) => {
        if (!active) return;
        setAppointment(value);
      })
      .catch((error) => {
        if (!active) return;
        setAppointment(null);
        setAppointmentError(error instanceof Error ? error.message : 'Could not verify this appointment.');
      })
      .finally(() => {
        if (active) setAppointmentLoading(false);
      });
    return () => { active = false; };
  }, [appointmentId, demoAppointment, session]);

  const paymentMethod: AppointmentPaymentMethod = appointment?.paymentMethod ?? routePaymentMethod;
  const serviceName = appointment?.serviceName ?? (single(params.serviceName) || 'Pet care appointment');
  const providerName = appointment?.providerName ?? (single(params.providerName) || 'MyPet provider');
  const petName = appointment?.petName ?? (single(params.petName) || 'Your pet');
  const slotStart = appointment?.slotStartsAt ?? single(params.slotStart);
  const slotEnd = appointment?.slotEndsAt ?? single(params.slotEnd);
  const amount = appointment?.priceAmount ?? routeAmount;
  const online = paymentMethod === 'ONLINE_PAYMENT' && !demoAppointment;

  useEffect(() => {
    if (!session || !appointmentId || !online) {
      setPendingRecovery(null);
      return;
    }
    let active = true;
    void loadPendingAppointmentPayment().then((recovery) => {
      if (!active) return;
      setPendingRecovery(recovery?.appointmentId === appointmentId ? recovery : null);
    });
    return () => { active = false; };
  }, [appointmentId, online, session]);

  const goToAppointments = () => router.replace(`/appointments?appointmentId=${appointmentId}` as never);

  const handlePayAtProvider = async () => {
    if (!appointmentId || !session || (!demoAppointment && !appointment)) return;
    setConfirming(true);
    try {
      await confirmAppointmentHold(appointmentId, session.accessToken);
      Alert.alert(
        demoAppointment ? 'Demo booking request sent' : 'Booking request sent',
        demoAppointment
          ? `${serviceName} for ${petName} is in demo provider-confirmation mode.`
          : `${providerName} must accept ${serviceName} for ${petName} before the appointment becomes confirmed. Payment remains due at the provider.`,
        [{ text: 'View appointments', onPress: goToAppointments }],
      );
    } catch (error) {
      Alert.alert('Request failed', error instanceof Error ? error.message : 'Could not send this booking request. Please retry.');
    } finally {
      setConfirming(false);
    }
  };

  const finishOnlinePayment = async (payment: CustomerPaymentView) => {
    const verified = await waitForPaymentOutcome(payment.paymentId);
    if (verified.referenceType !== 'APPOINTMENT' || verified.referenceId !== appointmentId) {
      throw new Error('Payment verification returned a different appointment.');
    }
    if (verified.status === 'CAPTURED') {
      setPendingRecovery(null);
      Alert.alert(
        'Payment successful · waiting for provider',
        `${money(verified.amountPaise / 100)} was verified by MyPet. ${providerName} must still accept the booking request before the appointment becomes Confirmed. If the provider declines, MyPet starts the refund workflow automatically.`,
        [{ text: 'View appointments', onPress: goToAppointments }],
      );
      return;
    }
    if (verified.status === 'FAILED' || verified.status === 'EXPIRED') {
      setPendingRecovery(null);
      Alert.alert('Payment not completed', 'The appointment was not sent to the provider as a confirmed payment request. Choose an available slot and try again.');
      return;
    }
    setPendingRecovery({ paymentId: payment.paymentId, appointmentId });
    Alert.alert('Still verifying payment', 'MyPet has not received a final Cashfree result yet. Do not pay again. Use Resume payment on this screen to continue verification.');
  };

  const verifyOnlinePayment = async (payment: CustomerPaymentView, launchProvider: boolean) => {
    if (payment.referenceType !== 'APPOINTMENT' || payment.referenceId !== appointmentId) {
      throw new Error('The pending payment does not belong to this appointment.');
    }
    setVerifying(true);
    try {
      if (launchProvider && (payment.status === 'PENDING' || payment.status === 'AUTHORIZED') && payment.paymentSessionId) {
        await openCashfreeOrder(payment).catch(() => 'ERROR' as const);
      }
      await finishOnlinePayment(payment);
    } finally {
      setVerifying(false);
    }
  };

  const handleOnlinePayment = async () => {
    if (!appointmentId || !appointment) return;
    setConfirming(true);
    try {
      if (pendingRecovery) {
        const pending = await fetchPaymentStatus(pendingRecovery.paymentId);
        await verifyOnlinePayment(pending, true);
        return;
      }
      const payment = await initiateAppointmentPayment(appointmentId);
      if (payment.referenceType !== 'APPOINTMENT' || payment.referenceId !== appointmentId) {
        throw new Error('The payment session does not belong to this appointment.');
      }
      setPendingRecovery({ paymentId: payment.paymentId, appointmentId });
      await verifyOnlinePayment(payment, true);
    } catch (error) {
      Alert.alert(
        pendingRecovery ? 'Could not resume payment' : 'Payment could not be completed',
        error instanceof Error ? error.message : 'Could not start or verify the appointment payment.',
      );
    } finally {
      setConfirming(false);
    }
  };

  if (!user || !session) {
    return <ScreenShell scroll={false} header={<AppBar title="Send booking request" />}><StateView kind="unauthenticated" title="Sign in required" message="Sign in again to review this appointment request." /></ScreenShell>;
  }
  if (!appointmentId) {
    return <ScreenShell scroll={false} header={<AppBar title="Send booking request" />}><StateView kind="error" title="Invalid appointment" message="The appointment hold is missing. Choose the slot again." /></ScreenShell>;
  }
  if (!demoAppointment && appointmentLoading) {
    return <ScreenShell scroll={false} header={<AppBar title="Verifying appointment" />}><StateView kind="loading" title="Verifying appointment…" message="MyPet is loading the server-stored appointment, price and payment method." /></ScreenShell>;
  }
  if (!demoAppointment && (appointmentError || !appointment)) {
    return <ScreenShell scroll={false} header={<AppBar title="Verify appointment" />}><StateView kind="error" title="Appointment could not be verified" message={appointmentError ?? 'The appointment is unavailable.'} /></ScreenShell>;
  }
  if (verifying) {
    return <ScreenShell scroll={false} header={<AppBar title="Verifying payment" />}><StateView kind="loading" title="Verifying payment…" message="Do not pay again based on the Cashfree screen. MyPet is checking the canonical backend payment state." /></ScreenShell>;
  }

  return (
    <ScreenShell header={<AppBar title={online ? 'Pay & send request' : 'Send booking request'} subtitle="Provider confirmation required" />}>
      <View style={styles.container}>
        {pendingRecovery ? <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}><StatusBadge label="PAYMENT VERIFICATION PENDING" tone="warning" /><ThemedText type="small" themeColor="textSecondary">This appointment already has a Cashfree payment in progress. Resume it instead of creating another payment.</ThemedText></View> : null}
        <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
          <StatusBadge label={demoAppointment ? 'DEMO · PROVIDER CONFIRMATION' : online ? 'PAYMENT FIRST · PROVIDER ACCEPTANCE NEXT' : 'WAITING FOR PROVIDER ACCEPTANCE'} tone="warning" />
          <ThemedText type="small" themeColor="textSecondary">{demoAppointment ? 'Development fixture only. No real provider or payment action is created.' : online ? 'Cashfree payment is verified by the backend first. A successful payment sends the request to the provider as Waiting for Provider; only the provider can make it Confirmed.' : 'Sending this request reserves the selected slot. The appointment is confirmed only after the provider accepts it.'}</ThemedText>
        </View>
        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Booking request</ThemedText>
          <ThemedText style={styles.serviceName}>{serviceName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{providerName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Pet: {petName}</ThemedText>
          {slotStart ? <ThemedText type="small" themeColor="textSecondary">Slot: {formatInstant(slotStart)}{slotEnd ? ` – ${formatInstant(slotEnd)}` : ''}</ThemedText> : null}
        </View>
        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Service fee</ThemedText>
          <View style={styles.row}><ThemedText themeColor="textSecondary">{online ? 'Pay online with Cashfree' : 'Pay at provider after acceptance'}</ThemedText><ThemedText style={[styles.totalValue, { color: theme.primary }]}>{money(amount)}</ThemedText></View>
          <ThemedText type="small" themeColor="textSecondary">{online ? 'This amount and payment method are loaded from the server-stored appointment. Cashfree results are verified by the backend before MyPet treats payment as captured.' : 'The amount and payment method are loaded from the server-stored appointment. No online charge is created.'}</ThemedText>
        </View>
        <PrimaryAction label={confirming ? pendingRecovery ? 'Resuming payment…' : online ? 'Starting payment…' : 'Sending request…' : pendingRecovery ? 'Resume payment' : online ? 'Pay online & send request' : 'Send booking request · Pay at provider'} loading={confirming} onPress={() => void (online ? handleOnlinePayment() : handlePayAtProvider())} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x2 },
  cardTitle: { ...typography.label, fontWeight: '800' },
  serviceName: { ...typography.headline, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  totalValue: { fontWeight: '900', fontSize: 20 },
  notice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x2 },
});
