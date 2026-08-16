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

export default function AppointmentPaymentScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const router = useRouter();
  const theme = useTheme();
  const { user, session } = useAuth();
  const [confirming, setConfirming] = useState(false);

  const appointmentId = single(params.appointmentId);
  const serviceName = single(params.serviceName) || 'Pet care appointment';
  const providerName = single(params.providerName) || 'MyPet provider';
  const petName = single(params.petName) || 'Your pet';
  const slotStart = single(params.slotStart);
  const slotEnd = single(params.slotEnd);
  const amount = useMemo(() => {
    const parsed = Number(single(params.amount));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [params.amount]);
  const demoAppointment = appConfig.allowDemoMode && appointmentId.startsWith('demo-appointment-');

  const handleConfirm = async () => {
    if (!appointmentId || !session) return;
    setConfirming(true);
    try {
      await confirmAppointmentHold(appointmentId, session.accessToken);
      Alert.alert(
        demoAppointment ? 'Demo booking request sent' : 'Booking request sent',
        demoAppointment
          ? `${serviceName} for ${petName} is in demo provider-confirmation mode.`
          : `${providerName} must accept ${serviceName} for ${petName} before the appointment becomes confirmed. Payment remains due at the provider; no online charge was attempted.`,
        [{ text: 'View appointments', onPress: () => router.replace(`/appointments?appointmentId=${appointmentId}` as never) }],
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
    <ScreenShell header={<AppBar title="Send booking request" subtitle="Provider confirmation required" />}>
      <View style={styles.container}>
        <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
          <StatusBadge
            label={demoAppointment ? 'DEMO · PROVIDER CONFIRMATION' : 'WAITING FOR PROVIDER ACCEPTANCE'}
            tone="warning"
          />
          <ThemedText type="small" themeColor="textSecondary">
            {demoAppointment
              ? 'Development fixture only. No real provider or payment action is created.'
              : 'Sending this request reserves the selected slot for this booking. The appointment is confirmed only after the provider accepts it.'}
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
            <ThemedText themeColor="textSecondary">Pay at provider after acceptance</ThemedText>
            <ThemedText style={[styles.totalValue, { color: theme.primary }]}>{money(amount)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            The backend stores the authoritative price snapshot when the slot is held. No online payment is created for this booking request.
          </ThemedText>
        </View>

        <PrimaryAction
          label="Send booking request · Pay at provider"
          loading={confirming}
          onPress={() => void handleConfirm()}
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
