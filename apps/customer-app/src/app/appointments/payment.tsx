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
 * Plan 5 online payments are intentionally limited to canonical PRODUCT_ORDER
 * references. Appointment online payment belongs to Plan 8 and therefore fails
 * closed here instead of reviving the legacy client-authored amount/payment API.
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

  const finishDemoAppointment = async () => {
    if (!session) return;
    await confirmAppointmentHold(appointmentId, session.accessToken, 'demo-payment');
    Alert.alert(
      'Demo appointment confirmed',
      `${serviceName} for ${petName} is confirmed at ${providerName}. No real payment was created.`,
      [{ text: 'View appointments', onPress: () => router.replace(`/appointments?appointmentId=${appointmentId}` as never) }],
    );
  };

  const handleDemoPayment = async () => {
    if (!demoPayment || !session) return;
    setPaying(true);
    try {
      await finishDemoAppointment();
    } catch (error) {
      Alert.alert('Demo confirmation failed', error instanceof Error ? error.message : 'Could not confirm the demo appointment.');
    } finally {
      setPaying(false);
    }
  };

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment payment" />}>
        <StateView kind="unauthenticated" title="Sign in required" message="Sign in again to review this appointment." />
      </ScreenShell>
    );
  }

  if (!appointmentId || amount <= 0) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment payment" />}>
        <StateView kind="error" title="Invalid appointment" message="The appointment reference or quoted display amount is missing. Choose the slot again." />
      </ScreenShell>
    );
  }

  if (!demoPayment) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Appointment payment" />}>
        <StateView
          kind="error"
          title="Online appointment payment is not available yet"
          message="Plan 5 online payment is limited to product orders. Appointment payment remains disabled until the Plan 8 server contract is available. No charge has been attempted."
          actionLabel="Back to appointments"
          onAction={() => router.back()}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell header={<AppBar title="Demo appointment" subtitle="Development simulation only" />}>
      <View style={styles.container}>
        <View style={[styles.demoNotice, { backgroundColor: theme.primarySoft }]}>
          <StatusBadge label="DEMO PAYMENT" tone="warning" />
          <ThemedText type="small" themeColor="textSecondary">
            Development fixture only. No real money will be charged and no Cashfree session is created.
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
          <ThemedText style={styles.cardTitle}>Demo amount</ThemedText>
          <View style={styles.row}>
            <ThemedText themeColor="textSecondary">Displayed total</ThemedText>
            <ThemedText style={[styles.totalValue, { color: theme.primary }]}>{money(amount)}</ThemedText>
          </View>
        </View>

        <PrimaryAction
          label={`Complete demo · ${money(amount)}`}
          loading={paying}
          onPress={() => void handleDemoPayment()}
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
  demoNotice: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x2 },
});
