import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

interface PaymentScreenContext {
  userId: string | null;
  accessToken: string | null;
  appointmentId: string;
}

interface PaymentActionContext {
  generation: number;
  userId: string;
  accessToken: string;
  appointmentId: string;
}

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

function samePaymentContext(left: PaymentScreenContext | null, right: PaymentActionContext): boolean {
  return left !== null
    && left.userId === right.userId
    && left.accessToken === right.accessToken
    && left.appointmentId === right.appointmentId;
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
  const paymentGenerationRef = useRef(0);
  const paymentInFlightRef = useRef(false);
  const paymentContextRef = useRef<PaymentScreenContext | null>(null);

  const appointmentId = single(params.appointmentId);
  const demoAppointment = appConfig.allowDemoMode && appointmentId.startsWith('demo-appointment-');
  const routePaymentMethod: AppointmentPaymentMethod = single(params.paymentMethod) === 'PAY_AT_PROVIDER'
    ? 'PAY_AT_PROVIDER'
    : 'ONLINE_PAYMENT';
  const routeAmount = useMemo(() => {
    const parsed = Number(single(params.amount));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [params.amount]);

  useLayoutEffect(() => {
    paymentContextRef.current = {
      userId: user?.id ?? null,
      accessToken: session?.accessToken ?? null,
      appointmentId,
    };
    paymentGenerationRef.current += 1;
    paymentInFlightRef.current = false;
    setConfirming(false);
    setVerifying(false);
  }, [appointmentId, session?.accessToken, user?.id]);

  useEffect(() => () => {
    paymentGenerationRef.current += 1;
    paymentInFlightRef.current = false;
  }, []);

  const beginPaymentAction = (): PaymentActionContext | null => {
    if (!user || !session || !appointmentId || paymentInFlightRef.current) return null;
    const action: PaymentActionContext = {
      generation: paymentGenerationRef.current + 1,
      userId: user.id,
      accessToken: session.accessToken,
      appointmentId,
    };
    paymentGenerationRef.current = action.generation;
    paymentInFlightRef.current = true;
    return action;
  };

  const isCurrentPaymentAction = (action: PaymentActionContext): boolean =>
    paymentGenerationRef.current === action.generation
    && samePaymentContext(paymentContextRef.current, action);

  const finishPaymentAction = (action: PaymentActionContext) => {
    if (!isCurrentPaymentAction(action)) return;
    paymentInFlightRef.current = false;
    setConfirming(false);
    setVerifying(false);
  };

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
    if (!session || !user || !appointmentId || !online) {
      setPendingRecovery(null);
      return;
    }
    let active = true;
    const expectedUserId = user.id;
    void loadPendingAppointmentPayment(expectedUserId).then((recovery) => {
      if (!active) return;
      setPendingRecovery(
        recovery?.customerId === expectedUserId && recovery.appointmentId === appointmentId
          ? recovery
          : null,
      );
    });
    return () => { active = false; };
  }, [appointmentId, online, session, user]);

  const goToAppointments = () => router.replace(`/appointments?appointmentId=${appointmentId}` as never);

  const handlePayAtProvider = async () => {
    if (!appointmentId || !session || !user || (!demoAppointment && !appointment)) return;
    const action = beginPaymentAction();
    if (!action) return;
    setConfirming(true);
    try {
      await confirmAppointmentHold(action.appointmentId, action.accessToken);
      if (!isCurrentPaymentAction(action)) return;

      if (demoAppointment) {
        Alert.alert(
          'Demo booking request sent',
          `${serviceName} for ${petName} is in demo provider-confirmation mode.`,
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
        return;
      }

      const canonical = await fetchAppointmentDetails(action.appointmentId, action.accessToken);
      if (!isCurrentPaymentAction(action)) return;
      setAppointment(canonical);
      if (canonical.status === 'PENDING_PROVIDER') {
        Alert.alert(
          'Booking request sent · waiting for provider',
          `${canonical.providerName} must accept ${canonical.serviceName} for ${canonical.petName} before the appointment becomes Confirmed. Payment remains due at the provider.`,
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
      } else if (canonical.status === 'CONFIRMED') {
        Alert.alert(
          'Provider confirmed appointment',
          'The server reports that the provider has already accepted this booking request.',
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
      } else {
        Alert.alert(
          'Appointment status changed',
          'The request completed, but the appointment is no longer waiting for provider confirmation. Open appointments for the canonical status.',
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
      }
    } catch (error) {
      if (!isCurrentPaymentAction(action)) return;
      Alert.alert('Request failed', error instanceof Error ? error.message : 'Could not send this booking request. Please retry.');
    } finally {
      finishPaymentAction(action);
    }
  };

  const finishOnlinePayment = async (payment: CustomerPaymentView, action: PaymentActionContext) => {
    const verified = await waitForPaymentOutcome(payment.paymentId, 30, 2_000, action.userId, {
      referenceType: 'APPOINTMENT',
      referenceId: action.appointmentId,
    });
    if (!isCurrentPaymentAction(action)) return;
    if (verified.referenceType !== 'APPOINTMENT' || verified.referenceId !== action.appointmentId) {
      throw new Error('Payment verification returned a different appointment.');
    }
    if (verified.status === 'CAPTURED') {
      const canonical = await fetchAppointmentDetails(action.appointmentId, action.accessToken);
      if (!isCurrentPaymentAction(action)) return;
      setAppointment(canonical);
      setPendingRecovery(null);

      if (canonical.status === 'PENDING_PROVIDER') {
        Alert.alert(
          'Payment successful · waiting for provider',
          `${money(verified.amountPaise / 100)} was verified by MyPet. ${canonical.providerName} must still accept the booking request before the appointment becomes Confirmed. If the provider declines, MyPet starts the refund workflow automatically.`,
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
      } else if (canonical.status === 'CONFIRMED') {
        Alert.alert(
          'Payment successful · provider confirmed',
          `${money(verified.amountPaise / 100)} was verified by MyPet, and the server reports that the provider has accepted the appointment.`,
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
      } else {
        Alert.alert(
          canonical.paymentStatus === 'REFUND_PENDING' ? 'Payment captured · refund pending' : 'Payment captured · booking unavailable',
          'Cashfree capture was verified, but the appointment is not in a provider-request state. MyPet will show the canonical refund/payment status in appointment history; do not pay again.',
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
      }
      return;
    }
    if (verified.status === 'FAILED' || verified.status === 'EXPIRED') {
      setPendingRecovery(null);
      Alert.alert('Payment not completed', 'The appointment was not sent to the provider as a confirmed payment request. Choose an available slot and try again.');
      return;
    }
    setPendingRecovery({
      paymentId: payment.paymentId,
      appointmentId: action.appointmentId,
      customerId: action.userId,
    });
    Alert.alert('Still verifying payment', 'MyPet has not received a final Cashfree result yet. Do not pay again. Use Resume payment on this screen to continue verification.');
  };

  const verifyOnlinePayment = async (
    payment: CustomerPaymentView,
    launchProvider: boolean,
    action: PaymentActionContext,
  ) => {
    if (payment.referenceType !== 'APPOINTMENT' || payment.referenceId !== action.appointmentId) {
      throw new Error('The pending payment does not belong to this appointment.');
    }
    if (!isCurrentPaymentAction(action)) return;
    setVerifying(true);
    try {
      if (launchProvider && (payment.status === 'PENDING' || payment.status === 'AUTHORIZED') && payment.paymentSessionId) {
        await openCashfreeOrder(payment).catch(() => 'ERROR' as const);
        if (!isCurrentPaymentAction(action)) return;
      }
      await finishOnlinePayment(payment, action);
    } finally {
      if (isCurrentPaymentAction(action)) setVerifying(false);
    }
  };

  const handleOnlinePayment = async () => {
    if (!appointmentId || !appointment || !user || !session) return;
    const action = beginPaymentAction();
    if (!action) return;
    setConfirming(true);
    const recoveryAtStart = pendingRecovery;
    try {
      if (recoveryAtStart) {
        if (recoveryAtStart.customerId !== action.userId || recoveryAtStart.appointmentId !== action.appointmentId) {
          throw new Error('The pending payment belongs to a different account or appointment.');
        }
        const pending = await fetchPaymentStatus(recoveryAtStart.paymentId, {
          referenceType: 'APPOINTMENT',
          referenceId: action.appointmentId,
        });
        if (!isCurrentPaymentAction(action)) return;
        await verifyOnlinePayment(pending, true, action);
        return;
      }
      const payment = await initiateAppointmentPayment(action.appointmentId, action.userId);
      if (!isCurrentPaymentAction(action)) return;
      if (payment.referenceType !== 'APPOINTMENT' || payment.referenceId !== action.appointmentId) {
        throw new Error('The payment session does not belong to this appointment.');
      }
      setPendingRecovery({
        paymentId: payment.paymentId,
        appointmentId: action.appointmentId,
        customerId: action.userId,
      });
      await verifyOnlinePayment(payment, true, action);
    } catch (error) {
      if (!isCurrentPaymentAction(action)) return;
      Alert.alert(
        recoveryAtStart ? 'Could not resume payment' : 'Payment could not be completed',
        error instanceof Error ? error.message : 'Could not start or verify the appointment payment.',
      );
    } finally {
      finishPaymentAction(action);
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
  if (!demoAppointment && appointment && appointment.status !== 'SLOT_HELD') {
    const waiting = appointment.status === 'PENDING_PROVIDER' || appointment.status === 'CONFIRMED';
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment status" />}>
        <StateView
          kind={waiting ? 'empty' : 'error'}
          title={waiting ? 'Booking request already sent' : 'Appointment is no longer payable'}
          message={waiting
            ? 'This appointment has already moved beyond the payment/hold step. Open appointments for the current provider-confirmation and payment state.'
            : 'This hold is no longer eligible for payment. Open appointments for the canonical status, refund state, or a new booking action.'}
          actionLabel="View appointments"
          onAction={goToAppointments}
        />
      </ScreenShell>
    );
  }
  if (!demoAppointment && appointment && online && appointment.paymentStatus !== 'PENDING') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment payment" />}>
        <StateView
          kind="error"
          title="Appointment payment is not payable"
          message="The server no longer reports this hold as an active pending online payment. Open appointments for the canonical payment or refund state."
          actionLabel="View appointments"
          onAction={goToAppointments}
        />
      </ScreenShell>
    );
  }
  if (verifying) {
    return <ScreenShell scroll={false} header={<AppBar title="Verifying payment" />}><StateView kind="loading" title="Verifying payment…" message="Do not pay again based on the Cashfree screen. MyPet is checking the canonical backend payment state." /></ScreenShell>;
  }

  return (
    <ScreenShell header={<AppBar title={online ? 'Pay & send request' : 'Send booking request'} subtitle="Provider confirmation required" />}>
      <View style={styles.container}>
        {pendingRecovery ? <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}><StatusBadge label="PAYMENT VERIFICATION PENDING" tone="warning" /><ThemedText type="small" themeColor="textSecondary">This appointment already has a Cashfree payment in progress for this account. Resume it instead of creating another payment.</ThemedText></View> : null}
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
        <PrimaryAction label={confirming ? pendingRecovery ? 'Resuming payment…' : online ? 'Starting payment…' : 'Sending request…' : pendingRecovery ? 'Resume payment' : online ? 'Pay online & send request' : 'Send booking request · Pay at provider'} loading={confirming} disabled={confirming || verifying} onPress={() => void (online ? handleOnlinePayment() : handlePayAtProvider())} />
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
