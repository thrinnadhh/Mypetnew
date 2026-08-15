import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingPaymentRecovery {
  paymentId: string;
  orderId: string;
}

const RECOVERY_KEY = 'mypet.customer.pending-payment.v1';

export async function rememberPendingPayment(paymentId: string, orderId: string): Promise<void> {
  if (!paymentId || !orderId) return;
  await AsyncStorage.setItem(RECOVERY_KEY, JSON.stringify({ paymentId, orderId } satisfies PendingPaymentRecovery));
}

export async function loadPendingPayment(): Promise<PendingPaymentRecovery | null> {
  const raw = await AsyncStorage.getItem(RECOVERY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPaymentRecovery>;
    if (typeof parsed.paymentId !== 'string' || typeof parsed.orderId !== 'string') {
      await AsyncStorage.removeItem(RECOVERY_KEY);
      return null;
    }
    return { paymentId: parsed.paymentId, orderId: parsed.orderId };
  } catch {
    await AsyncStorage.removeItem(RECOVERY_KEY);
    return null;
  }
}

export async function clearPendingPayment(expectedPaymentId?: string): Promise<void> {
  if (expectedPaymentId) {
    const current = await loadPendingPayment();
    if (current && current.paymentId !== expectedPaymentId) return;
  }
  await AsyncStorage.removeItem(RECOVERY_KEY);
}
