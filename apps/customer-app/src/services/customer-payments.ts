import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  CFPaymentGatewayService,
  type CFCallback,
  type CFErrorResponse,
} from 'react-native-cashfree-pg-sdk';
import {
  CFEnvironment,
  CFSession,
} from 'cashfree-pg-api-contract';

import type {
  CustomerPaymentStatus,
  CustomerRefundStatus,
} from '../contracts/customer-payment';
import { appConfig } from '../utils/app-config';
import { apiClient } from './api-client';

export interface CustomerPaymentView {
  paymentId: string;
  referenceType: 'PRODUCT_ORDER';
  referenceId: string;
  provider: 'CASHFREE';
  providerOrderId: string;
  status: CustomerPaymentStatus;
  paymentSessionId: string | null;
  expiresAt: string;
  amountPaise: number;
  currency: 'INR';
  refundStatus?: CustomerRefundStatus | null;
}

export interface PendingPaymentRecovery {
  paymentId: string;
  orderId: string;
}

export type CashfreeCallbackSignal = 'VERIFY' | 'ERROR';

const RECOVERY_KEY = 'mypet.customer.pending-payment.v1';

export async function initiateOrderPayment(
  orderId: string,
  idempotencyKey = Crypto.randomUUID(),
): Promise<CustomerPaymentView> {
  const payment = await apiClient.post<CustomerPaymentView>(
    '/api/v1/customer/payments',
    {
      referenceType: 'PRODUCT_ORDER',
      referenceId: orderId,
      provider: 'CASHFREE',
    },
    { 'Idempotency-Key': idempotencyKey },
  );
  await rememberPendingPayment(payment.paymentId, orderId);
  return payment;
}

export async function fetchPaymentStatus(paymentId: string): Promise<CustomerPaymentView> {
  return apiClient.get<CustomerPaymentView>(
    `/api/v1/customer/payments/${encodeURIComponent(paymentId)}`,
  );
}

/**
 * The Cashfree native callback is never payment truth. Both callback paths only
 * return a local signal so the caller can show "Verifying payment…" and poll
 * the canonical backend.
 */
export async function openCashfreeOrder(payment: CustomerPaymentView): Promise<CashfreeCallbackSignal> {
  if (!payment.paymentSessionId || !payment.providerOrderId) {
    throw new Error('Cashfree returned an invalid checkout session.');
  }
  const environment = appConfig.environment === 'production'
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.SANDBOX;
  const session = new CFSession(payment.paymentSessionId, payment.providerOrderId, environment);

  return new Promise<CashfreeCallbackSignal>((resolve, reject) => {
    let settled = false;
    const settle = (signal: CashfreeCallbackSignal) => {
      if (settled) return;
      settled = true;
      CFPaymentGatewayService.removeCallback();
      resolve(signal);
    };
    const callback: CFCallback = {
      onVerify: () => settle('VERIFY'),
      onError: (_error: CFErrorResponse, _orderId: string) => settle('ERROR'),
    };

    try {
      CFPaymentGatewayService.setCallback(callback);
      CFPaymentGatewayService.doWebPayment(session);
    } catch (error) {
      CFPaymentGatewayService.removeCallback();
      reject(error);
    }
  });
}

export async function waitForPaymentOutcome(
  paymentId: string,
  attempts = 30,
  delayMs = 2_000,
): Promise<CustomerPaymentView> {
  let latest = await fetchPaymentStatus(paymentId);
  for (
    let attempt = 1;
    attempt < attempts && (latest.status === 'PENDING' || latest.status === 'AUTHORIZED');
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await fetchPaymentStatus(paymentId);
  }
  if (latest.status === 'CAPTURED' || latest.status === 'FAILED' || latest.status === 'EXPIRED') {
    await clearPendingPayment(paymentId);
  }
  return latest;
}

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

// Plan 8 appointment payment runtime is intentionally fail-closed in Plan 5.
export async function initiateAppointmentPayment(): Promise<never> {
  throw new Error('Appointment online payment is not available yet.');
}
