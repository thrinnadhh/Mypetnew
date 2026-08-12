import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppBar, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { confirmAppointmentHold } from '@/services/appointment-booking';
import {
  initiateAppointmentPayment,
  openCashfreeOrder,
  waitForReferencePaymentOutcome,
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
  const [paying, setPaying] = useState(false);

  const appointmentId = single(params.appointmentId);
  const serviceName = single(params.serviceName) || 'Pet care appointment';
  const providerName = single(params.providerName) || 'MyPet provider';
  const petName = single(params.petName) || 'Your pet';
  const slotStart = single(params.slotStart);
  const slotEnd = single(params.slotEnd);
  const amount = useMemo(() => {
    const parsed = Number(single(params.amount));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [params.amount]);
  const demoPayment = appConfig.allowDemoMode && appointmentId.startsWith('demo-appointment-');

  const finishAppointment = async (paymentId?: string) => {
    await confirmAppointmentHold(appointmentId, session?.access_token, paymentId);
    Alert.alert(
      'Appointment confirmed',
      `${serviceName} for ${petName} is confirmed at ${providerName}.`,
      [{ text: 'View appointments', onPress: () => router.replace(`/appointments?appointmentId=${appointmentId}` as never) }],
    );
  };

  const handlePayment = async () => {
    if (!user || !session || !appointmentId || amount <= 0) return;
    setPaying(true);
    try {
      if (demoPayment) {
        await finishAppointment('demo-payment');
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const initialization = await initiateAppointmentPayment(user.id, appointmentId, amount, {
        phone: user.phone || String(metadata?.phone || metadata?.mobile || ''),
        email: user.email,
        name: String(metadata?.full_name || metadata?.name || '').trim() || null,
      });
      await openCashfreeOrder(initialization);
      const payment = await waitForReferencePaymentOutcome(appointmentId);

      if (payment.status === 'SUCCESS') {
        await finishAppointment(payment.transactionId);
      } else if (payment.status === 'PENDING') {
        Alert.alert(
          'Payment confirmation pending',
          'Cashfree has not confirmed this payment yet. The appointment remains held until the hold expires; retry payment if needed.',
        );
      } else {
        Alert.alert('Payment not completed', 'No successful payment was confirmed. Your appointment has not been confirmed.');
      }
    } catch (error) {
      Alert.alert('Payment failed', error instanceof Error ? error.message : 'Could not complete appointment payment.');
    } finally {
      setPaying(false);
    }
  };

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment payment" />}>
        <StateView kind="unauthenticated" title="Sign in required" message="Sign in again to securely complete this appointment payment." />
      </ScreenShell>
    );
  }

  if (!appointmentId || amount <= 0) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment payment" />}>
        <StateView kind="error" title="Invalid appointment payment" message="The appointment reference or payable amount is missing. Choose the slot again." />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell header={<AppBar title="Appointment payment" subtitle="Review before paying" />}>
      <View style={styles.container}>
        {demoPayment ? (
          <View style={[styles.demoNotice, { backgroundColor: theme.primarySoft }]}>
            <StatusBadge label="DEMO PAYMENT" tone="warning" />
            <ThemedText type="small" themeColor="textSecondary">
              Development fixture only. No real money will be charged.
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Booking details</ThemedText>
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
          <ThemedText style={styles.cardTitle}>Payment breakdown</ThemedText>
          <PriceRow label="Service fee" value={money(amount)} />
          <PriceRow label="Booking fee" value="₹0.00" />
          <PriceRow label="Taxes" value="Included" />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.row}>
            <ThemedText style={styles.totalLabel}>Total payable</ThemedText>
            <ThemedText style={[styles.totalValue, { color: theme.primary }]}>{money(amount)}</ThemedText>
          </View>
        </View>

        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText style={styles.cardTitle}>Secure payment</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Continue to Cashfree to choose UPI, card, net banking or another enabled online payment method. The appointment is confirmed only after server-side payment verification.
          </ThemedText>
        </View>

        <PrimaryAction
          label={demoPayment ? `Complete demo payment · ${money(amount)}` : `Pay ${money(amount)} securely`}
          loading={paying}
          onPress={() => void handlePayment()}
        />
      </View>
    </ScreenShell>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText style={styles.priceValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x2 },
  cardTitle: { ...typography.label, fontWeight: '800' },
  serviceName: { ...typography.headline, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.x1 },
  priceValue: { fontWeight: '700' },
  totalLabel: { fontWeight: '900', fontSize: 16 },
  totalValue: { fontWeight: '900', fontSize: 20 },
  demoNotice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x2 },
});
