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
import {
  clearPendingPayment,
  loadPendingPayment,
  rememberPendingPayment,
  type PendingPaymentRecovery,
} from './payment-recovery';

export {
  clearPendingPayment,
  loadPendingPayment,
  rememberPendingPayment,
  type PendingPaymentRecovery,
} from './payment-recovery';

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

export type CashfreeCallbackSignal = 'VERIFY' | 'ERROR';

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

  // A Create Order HTTP timeout can leave MyPet with the durable Payment and
  // deterministic provider identity but without the provider session response.
  // Resume through the canonical initiation API: the backend maps a new client
  // command key to the same Payment/provider order and never creates a second
  // canonical Payment. If the retry returns the missing session, launch it and
  // still rely only on the backend afterwards.
  if (
    (latest.status === 'PENDING' || latest.status === 'AUTHORIZED') &&
    !latest.paymentSessionId
  ) {
    const resumed = await initiateOrderPayment(latest.referenceId);
    if (resumed.paymentId !== paymentId) {
      throw new Error('Payment recovery returned an inconsistent server payment.');
    }
    latest = resumed;
    if (latest.paymentSessionId) {
      await openCashfreeOrder(latest).catch(() => 'ERROR' as const);
      latest = await fetchPaymentStatus(paymentId);
    }
  }

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

// These compatibility exports intentionally keep the already-restored Plan 8
// screen compiling while the Plan 5 backend rejects APPOINTMENT references.
// They never perform network or provider I/O and therefore cannot accidentally
// revive the old client-authored appointment payment contract.
export async function initiateAppointmentPayment(
  _userId?: string,
  _appointmentId?: string,
  _amount?: number,
  _customer?: unknown,
): Promise<CustomerPaymentView> {
  throw new Error('Appointment online payment is not available until Plan 8.');
}

export async function waitForReferencePaymentOutcome(
  _referenceId: string,
): Promise<{ status: 'SUCCESS' | 'PENDING' | 'FAILED'; transactionId: string }> {
  throw new Error('Appointment online payment is not available until Plan 8.');
}
