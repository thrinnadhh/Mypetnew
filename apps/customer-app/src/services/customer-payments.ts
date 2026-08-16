import * as Crypto from 'expo-crypto';

import type {
  CustomerPaymentStatus,
  CustomerRefundStatus,
} from '../contracts/customer-payment';
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
  referenceType: 'PRODUCT_ORDER' | 'APPOINTMENT';
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

export async function initiateAppointmentPayment(
  appointmentId: string,
  idempotencyKey = Crypto.randomUUID(),
): Promise<CustomerPaymentView> {
  return apiClient.post<CustomerPaymentView>(
    '/api/v1/customer/payments',
    {
      referenceType: 'APPOINTMENT',
      referenceId: appointmentId,
      provider: 'CASHFREE',
    },
    { 'Idempotency-Key': idempotencyKey },
  );
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openCashfreeNativeCheckout } = require('./cashfree-native') as typeof import('./cashfree-native');
  return openCashfreeNativeCheckout({
    paymentSessionId: payment.paymentSessionId,
    providerOrderId: payment.providerOrderId,
  });
}

async function resumePayment(payment: CustomerPaymentView): Promise<CustomerPaymentView> {
  return payment.referenceType === 'APPOINTMENT'
    ? initiateAppointmentPayment(payment.referenceId)
    : initiateOrderPayment(payment.referenceId);
}

export async function waitForPaymentOutcome(
  paymentId: string,
  attempts = 30,
  delayMs = 2_000,
): Promise<CustomerPaymentView> {
  let latest = await fetchPaymentStatus(paymentId);

  // A Create Order HTTP timeout can leave a durable Payment/provider identity
  // without the provider session response. Re-enter canonical initiation with a
  // new command key; the backend binds it to the same payment reference.
  if (
    (latest.status === 'PENDING' || latest.status === 'AUTHORIZED') &&
    !latest.paymentSessionId
  ) {
    const resumed = await resumePayment(latest);
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

/**
 * Legacy compatibility helper. A reference alone is not enough to prove payment
 * success, so callers must first initiate a canonical payment and use its ID.
 */
export async function waitForReferencePaymentOutcome(
  _referenceId: string,
): Promise<{ status: 'SUCCESS' | 'PENDING' | 'FAILED'; transactionId: string }> {
  throw new Error('Use the canonical payment ID to verify appointment payment status.');
}
