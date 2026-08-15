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
import { appConfig } from '@/utils/app-config';

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function money(value: number): string {
  return `₹${value.toFixed(2)}`;
}

/**
 * Appointment online payment remains fail-closed until the server has a
 * provider-reconciled payment contract. Live appointments can still be safely
 * confirmed as PAY_AT_CLINIC; no Cashfree session or client-authored payment
 * success is used by this screen.
 */
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

  const confirmBooking = async () => {
    if (!session) return;
    setPaying(true);
    try {
      await confirmAppointmentHold(
        appointmentId,
        session.accessToken,
        demoPayment ? 'demo-payment' : undefined,
      );
      if (demoPayment) {
        Alert.alert(
          'Demo appointment confirmed',
          `${serviceName} for ${petName} is confirmed at ${providerName}. No real payment was created.`,
          [{ text: 'View appointment', onPress: () => router.replace(`/appointments/${appointmentId}` as never) }],
        );
      } else {
        Alert.alert(
          'Appointment confirmed',
          `${serviceName} for ${petName} is booked at ${providerName}. Pay ${money(amount)} at the clinic/provider.`,
          [{ text: 'View appointment', onPress: () => router.replace(`/appointments/${appointmentId}` as never) }],
        );
      }
    } catch (error) {
      Alert.alert(
        'Booking confirmation failed',
        error instanceof Error ? error.message : 'Could not confirm the appointment.',
      );
    } finally {
      setPaying(false);
    }
  };

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment booking" />}>
        <StateView kind="unauthenticated" title="Sign in required" message="Sign in again to review this appointment." />
      </ScreenShell>
    );
  }

  if (!appointmentId || amount <= 0) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment booking" />}>
        <StateView kind="error" title="Invalid appointment" message="The appointment reference or quoted display amount is missing. Choose the slot again." />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      header={
        <AppBar
          title={demoPayment ? 'Demo appointment' : 'Confirm appointment'}
          subtitle={demoPayment ? 'Development simulation only' : 'Pay at clinic/provider'}
        />
      }
    >
      <View style={styles.container}>
        <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
          <StatusBadge label={demoPayment ? 'DEMO PAYMENT' : 'PAY AT CLINIC'} tone="warning" />
          <ThemedText type="small" themeColor="textSecondary">
            {demoPayment
              ? 'Development fixture only. No real money will be charged and no Cashfree session is created.'
              : 'Online appointment payment is not available yet. No online charge will be attempted. Confirming reserves the appointment and payment is collected by the clinic/provider.'}
          </ThemedText>
        </View>

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
          <ThemedText style={styles.cardTitle}>{demoPayment ? 'Demo amount' : 'Amount due at clinic/provider'}</ThemedText>
          <View style={styles.row}>
            <ThemedText themeColor="textSecondary">Service total</ThemedText>
            <ThemedText style={[styles.totalValue, { color: theme.primary }]}>{money(amount)}</ThemedText>
          </View>
        </View>

        <PrimaryAction
          label={demoPayment ? `Complete demo · ${money(amount)}` : `Confirm booking · Pay ${money(amount)} at clinic`}
          loading={paying}
          onPress={() => void confirmBooking()}
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