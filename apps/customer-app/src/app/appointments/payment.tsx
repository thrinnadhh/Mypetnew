import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { confirmAppointmentHold, type AppointmentPaymentMethod } from '@/services/appointment-booking';
import {
  initiateAppointmentPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
} from '@/services/customer-payments';
import { appConfig } from '@/utils/app-config';

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function money(value: number): string {
  return `₹${value.toFixed(2)}`;
}

export default function AppointmentPaymentScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const router = useRouter();
  const theme = useTheme();
  const { user, session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const appointmentId = single(params.appointmentId);
  const serviceName = single(params.serviceName) || 'Pet care appointment';
  const providerName = single(params.providerName) || 'MyPet provider';
  const petName = single(params.petName) || 'Your pet';
  const slotStart = single(params.slotStart);
  const slotEnd = single(params.slotEnd);
  const paymentMethod: AppointmentPaymentMethod = single(params.paymentMethod) === 'PAY_AT_PROVIDER'
    ? 'PAY_AT_PROVIDER'
    : 'ONLINE_PAYMENT';
  const amount = useMemo(() => {
    const parsed = Number(single(params.amount));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [params.amount]);
  const demoAppointment = appConfig.allowDemoMode && appointmentId.startsWith('demo-appointment-');
  const online = paymentMethod === 'ONLINE_PAYMENT' && !demoAppointment;

  const goToAppointments = () => router.replace(`/appointments?appointmentId=${appointmentId}` as never);

  const handlePayAtProvider = async () => {
    if (!appointmentId || !session) return;
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
      Alert.alert(
        'Request failed',
        error instanceof Error ? error.message : 'Could not send this booking request. Please retry.',
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleOnlinePayment = async () => {
    if (!appointmentId) return;
    setConfirming(true);
    try {
      const payment = await initiateAppointmentPayment(appointmentId);
      await openCashfreeOrder(payment).catch(() => 'ERROR' as const);
      setVerifying(true);
      const verified = await waitForPaymentOutcome(payment.paymentId);
      if (verified.status === 'CAPTURED') {
        Alert.alert(
          'Payment successful · waiting for provider',
          `${money(verified.amountPaise / 100)} was verified by MyPet. ${providerName} must still accept the booking request before the appointment becomes Confirmed. If the provider declines, MyPet starts the refund workflow automatically.`,
          [{ text: 'View appointments', onPress: goToAppointments }],
        );
        return;
      }
      if (verified.status === 'FAILED' || verified.status === 'EXPIRED') {
        Alert.alert(
          'Payment not completed',
          'The appointment was not sent to the provider as a confirmed payment request. Choose an available slot and try again.',
        );
        return;
      }
      Alert.alert(
        'Still verifying payment',
        'MyPet has not received a final Cashfree result yet. Do not pay again. Retry verification from this screen after a moment.',
      );
    } catch (error) {
      Alert.alert(
        'Payment could not be completed',
        error instanceof Error ? error.message : 'Could not start or verify the appointment payment.',
      );
    } finally {
      setVerifying(false);
      setConfirming(false);
    }
  };

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Send booking request" />}>
        <StateView kind="unauthenticated" title="Sign in required" message="Sign in again to review this appointment request." />
      </ScreenShell>
    );
  }

  if (!appointmentId) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Send booking request" />}>
        <StateView kind="error" title="Invalid appointment" message="The appointment hold is missing. Choose the slot again." />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell header={<AppBar title={online ? 'Pay & send request' : 'Send booking request'} subtitle="Provider confirmation required" />}>
      <View style={styles.container}>
        <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
          <StatusBadge
            label={
              demoAppointment
                ? 'DEMO · PROVIDER CONFIRMATION'
                : online
                  ? 'PAYMENT FIRST · PROVIDER ACCEPTANCE NEXT'
                  : 'WAITING FOR PROVIDER ACCEPTANCE'
            }
            tone="warning"
          />
          <ThemedText type="small" themeColor="textSecondary">
            {demoAppointment
              ? 'Development fixture only. No real provider or payment action is created.'
              : online
                ? 'Cashfree payment is verified by the backend first. A successful payment sends the request to the provider as Waiting for Provider; only the provider can make it Confirmed.'
                : 'Sending this request reserves the selected slot. The appointment is confirmed only after the provider accepts it.'}
          </ThemedText>
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Booking request</ThemedText>
          <ThemedText style={styles.serviceName}>{serviceName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{providerName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Pet: {petName}</ThemedText>
          {slotStart ? (
            <ThemedText type="small" themeColor="textSecondary">
              Slot: {slotStart}{slotEnd ? ` – ${slotEnd}` : ''}
            </ThemedText>
          ) : null}
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Service fee</ThemedText>
          <View style={styles.row}>
            <ThemedText themeColor="textSecondary">{online ? 'Pay online with Cashfree' : 'Pay at provider after acceptance'}</ThemedText>
            <ThemedText style={[styles.totalValue, { color: theme.primary }]}>{money(amount)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {online
              ? 'The backend uses the server-stored appointment price. If payment is captured but the provider later rejects/cancels the request, MyPet creates a refund automatically.'
              : 'The backend stores the authoritative price snapshot when the slot is held. No online charge is created.'}
          </ThemedText>
        </View>

        <PrimaryAction
          label={verifying ? 'Verifying payment…' : online ? 'Pay online & send request' : 'Send booking request · Pay at provider'}
          loading={confirming}
          onPress={() => void (online ? handleOnlinePayment() : handlePayAtProvider())}
        />
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
