import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingAppointmentPaymentRecovery {
  paymentId: string;
  appointmentId: string;
  customerId: string;
}

const LEGACY_RECOVERY_KEY = 'mypet.customer.pending-appointment-payment.v1';
const RECOVERY_PREFIX = 'mypet.customer.pending-appointment-payment.v2.';

function recoveryKey(customerId: string): string {
  const normalized = customerId.trim();
  if (!normalized) throw new Error('Customer identity is required for appointment payment recovery.');
  return `${RECOVERY_PREFIX}${normalized}`;
}

export async function rememberPendingAppointmentPayment(
  paymentId: string,
  appointmentId: string,
  customerId: string,
): Promise<void> {
  if (!paymentId || !appointmentId || !customerId.trim()) return;
  await AsyncStorage.setItem(
    recoveryKey(customerId),
    JSON.stringify({ paymentId, appointmentId, customerId } satisfies PendingAppointmentPaymentRecovery),
  );
  // The v1 pointer carried no account identity and therefore cannot be safely
  // migrated. Remove it opportunistically once an authenticated account writes
  // a scoped recovery record.
  await AsyncStorage.removeItem(LEGACY_RECOVERY_KEY).catch(() => undefined);
}

export async function loadPendingAppointmentPayment(
  customerId: string,
): Promise<PendingAppointmentPaymentRecovery | null> {
  // Never surface the historical unscoped pointer to any account.
  await AsyncStorage.removeItem(LEGACY_RECOVERY_KEY).catch(() => undefined);
  const raw = await AsyncStorage.getItem(recoveryKey(customerId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingAppointmentPaymentRecovery>;
    if (
      typeof parsed.paymentId !== 'string' ||
      typeof parsed.appointmentId !== 'string' ||
      typeof parsed.customerId !== 'string' ||
      parsed.customerId !== customerId
    ) {
      await AsyncStorage.removeItem(recoveryKey(customerId));
      return null;
    }
    return {
      paymentId: parsed.paymentId,
      appointmentId: parsed.appointmentId,
      customerId: parsed.customerId,
    };
  } catch {
    await AsyncStorage.removeItem(recoveryKey(customerId));
    return null;
  }
}

export async function clearPendingAppointmentPayment(
  customerId: string,
  expectedPaymentId?: string,
): Promise<void> {
  if (expectedPaymentId) {
    const current = await loadPendingAppointmentPayment(customerId);
    if (current && current.paymentId !== expectedPaymentId) return;
  }
  await AsyncStorage.removeItem(recoveryKey(customerId));
}
