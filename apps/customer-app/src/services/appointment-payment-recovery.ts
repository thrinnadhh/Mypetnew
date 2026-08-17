import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingAppointmentPaymentRecovery {
  paymentId: string;
  appointmentId: string;
}

const RECOVERY_KEY = 'mypet.customer.pending-appointment-payment.v1';

export async function rememberPendingAppointmentPayment(
  paymentId: string,
  appointmentId: string,
): Promise<void> {
  if (!paymentId || !appointmentId) return;
  await AsyncStorage.setItem(
    RECOVERY_KEY,
    JSON.stringify({ paymentId, appointmentId } satisfies PendingAppointmentPaymentRecovery),
  );
}

export async function loadPendingAppointmentPayment(): Promise<PendingAppointmentPaymentRecovery | null> {
  const raw = await AsyncStorage.getItem(RECOVERY_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingAppointmentPaymentRecovery>;
    if (typeof parsed.paymentId !== 'string' || typeof parsed.appointmentId !== 'string') {
      await AsyncStorage.removeItem(RECOVERY_KEY);
      return null;
    }
    return { paymentId: parsed.paymentId, appointmentId: parsed.appointmentId };
  } catch {
    await AsyncStorage.removeItem(RECOVERY_KEY);
    return null;
  }
}

export async function clearPendingAppointmentPayment(expectedPaymentId?: string): Promise<void> {
  if (expectedPaymentId) {
    const current = await loadPendingAppointmentPayment();
    if (current && current.paymentId !== expectedPaymentId) return;
  }
  await AsyncStorage.removeItem(RECOVERY_KEY);
}
