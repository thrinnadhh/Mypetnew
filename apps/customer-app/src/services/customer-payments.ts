import * as Crypto from 'expo-crypto';

import type {
  CustomerPaymentStatus,
  CustomerRefundStatus,
} from '../contracts/customer-payment';
import { apiClient } from './api-client';
import {
  clearPendingAppointmentPayment,
  loadPendingAppointmentPayment,
  rememberPendingAppointmentPayment,
  type PendingAppointmentPaymentRecovery,
} from './appointment-payment-recovery';
import {
  clearPendingPayment,
  loadPendingPayment,
  rememberPendingPayment,
  type PendingPaymentRecovery,
} from './payment-recovery';

export {
  clearPendingAppointmentPayment,
  loadPendingAppointmentPayment,
  rememberPendingAppointmentPayment,
  type PendingAppointmentPaymentRecovery,
} from './appointment-payment-recovery';
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

const CUSTOMER_PAYMENT_STATUSES: readonly CustomerPaymentStatus[] = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'EXPIRED',
];

export interface ExpectedPaymentReference {
  referenceType?: CustomerPaymentView['referenceType'];
  referenceId?: string;
}

export interface CanonicalPaymentExpectations {
  expectedPaymentId?: string;
  referenceType?: CustomerPaymentView['referenceType'];
  referenceId?: string;
}

function invalidCanonicalPayment(): Error {
  return new Error('Payment service returned an invalid canonical payment response.');
}

/**
 * Network payment payloads are untrusted runtime data. Every canonical
 * CustomerPaymentView crossing this module is structurally and semantically
 * validated here — TypeScript interfaces alone are not validation.
 *
 * Zero-amount payments (amountPaise === 0) are intentionally accepted: the
 * backend schema does not prohibit them (e.g. fully discounted totals) and the
 * backend remains the monetary authority.
 */
export function validateCanonicalPayment(
  payment: unknown,
  expected: CanonicalPaymentExpectations = {},
): CustomerPaymentView {
  if (typeof payment !== 'object' || payment === null) throw invalidCanonicalPayment();
  const p = payment as Record<string, unknown>;
  if (
    typeof p.paymentId !== 'string' ||
    !p.paymentId ||
    (expected.expectedPaymentId !== undefined && p.paymentId !== expected.expectedPaymentId) ||
    (p.referenceType !== 'PRODUCT_ORDER' && p.referenceType !== 'APPOINTMENT') ||
    (expected.referenceType !== undefined && p.referenceType !== expected.referenceType) ||
    typeof p.referenceId !== 'string' ||
    !p.referenceId ||
    (expected.referenceId !== undefined && p.referenceId !== expected.referenceId) ||
    p.provider !== 'CASHFREE' ||
    typeof p.providerOrderId !== 'string' ||
    !p.providerOrderId ||
    p.currency !== 'INR' ||
    !Number.isSafeInteger(p.amountPaise) ||
    (p.amountPaise as number) < 0 ||
    !CUSTOMER_PAYMENT_STATUSES.includes(p.status as CustomerPaymentStatus) ||
    (p.paymentSessionId !== null &&
      (typeof p.paymentSessionId !== 'string' || !p.paymentSessionId)) ||
    typeof p.expiresAt !== 'string' ||
    !p.expiresAt ||
    Number.isNaN(Date.parse(p.expiresAt))
  ) {
    throw invalidCanonicalPayment();
  }
  return payment as CustomerPaymentView;
}

/**
 * Non-persisting initiation primitive. Requests a canonical payment from the
 * backend and validates the response, but NEVER touches recovery storage.
 * Persistence is the exclusive responsibility of the public initiate* wrappers,
 * so an inconsistent recovery response can never overwrite a valid pointer.
 */
async function requestOrderPayment(orderId: string, idempotencyKey: string): Promise<CustomerPaymentView> {
  const payment = await apiClient.post<CustomerPaymentView>(
    '/api/v1/customer/payments',
    {
      referenceType: 'PRODUCT_ORDER',
      referenceId: orderId,
      provider: 'CASHFREE',
    },
    { 'Idempotency-Key': idempotencyKey },
  );
  return validateCanonicalPayment(payment, { referenceType: 'PRODUCT_ORDER', referenceId: orderId });
}

async function requestAppointmentPayment(
  appointmentId: string,
  customerId: string,
  idempotencyKey: string,
): Promise<CustomerPaymentView> {
  const payment = await apiClient.post<CustomerPaymentView>(
    '/api/v1/customer/payments',
    {
      referenceType: 'APPOINTMENT',
      referenceId: appointmentId,
      provider: 'CASHFREE',
    },
    { 'Idempotency-Key': idempotencyKey },
  );
  return validateCanonicalPayment(payment, { referenceType: 'APPOINTMENT', referenceId: appointmentId });
}

export async function initiateOrderPayment(
  orderId: string,
  idempotencyKey = Crypto.randomUUID(),
): Promise<CustomerPaymentView> {
  const payment = await requestOrderPayment(orderId, idempotencyKey);
  await rememberPendingPayment(payment.paymentId, orderId);
  return payment;
}

export async function initiateAppointmentPayment(
  appointmentId: string,
  customerId: string,
  idempotencyKey = Crypto.randomUUID(),
): Promise<CustomerPaymentView> {
  const payment = await requestAppointmentPayment(appointmentId, customerId, idempotencyKey);
  await rememberPendingAppointmentPayment(payment.paymentId, appointmentId, customerId);
  return payment;
}

export async function fetchPaymentStatus(
  paymentId: string,
  expected?: ExpectedPaymentReference,
): Promise<CustomerPaymentView> {
  const payment = await apiClient.get<CustomerPaymentView>(
    `/api/v1/customer/payments/${encodeURIComponent(paymentId)}`,
  );
  return validateCanonicalPayment(payment, { ...expected, expectedPaymentId: paymentId });
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

/**
 * Recovery re-entry uses the non-persisting request primitives exclusively:
 * identity consistency (resumed paymentId === original paymentId) is proven by
 * the caller BEFORE any recovery-pointer mutation or provider launch. The
 * backend reuses the existing payment for the same customer+reference+provider,
 * so a different paymentId here is a genuine inconsistency and must fail closed
 * with the existing pointer untouched.
 */
async function resumePayment(
  payment: CustomerPaymentView,
  appointmentCustomerId?: string,
): Promise<CustomerPaymentView> {
  if (payment.referenceType === 'APPOINTMENT') {
    if (!appointmentCustomerId) {
      throw new Error('Current customer identity is required to recover an appointment payment.');
    }
    return requestAppointmentPayment(payment.referenceId, appointmentCustomerId, Crypto.randomUUID());
  }
  return requestOrderPayment(payment.referenceId, Crypto.randomUUID());
}

export async function waitForPaymentOutcome(
  paymentId: string,
  attempts = 30,
  delayMs = 2_000,
  appointmentCustomerId?: string,
  expectedReference?: ExpectedPaymentReference,
): Promise<CustomerPaymentView> {
  let latest = await fetchPaymentStatus(paymentId, expectedReference);
  if (latest.referenceType === 'APPOINTMENT' && !appointmentCustomerId) {
    throw new Error('Current customer identity is required to verify an appointment payment.');
  }

  // A Create Order HTTP timeout can leave a durable Payment/provider identity
  // without the provider session response. Re-enter canonical initiation with a
  // new command key; the backend binds it to the same payment reference.
  if (
    (latest.status === 'PENDING' || latest.status === 'AUTHORIZED') &&
    !latest.paymentSessionId
  ) {
    const resumed = await resumePayment(latest, appointmentCustomerId);
    if (resumed.paymentId !== paymentId) {
      throw new Error('Payment recovery returned an inconsistent server payment.');
    }
    latest = resumed;
    if (latest.paymentSessionId) {
      await openCashfreeOrder(latest).catch(() => 'ERROR' as const);
      latest = await fetchPaymentStatus(paymentId, expectedReference);
    }
  }

  for (
    let attempt = 1;
    attempt < attempts && (latest.status === 'PENDING' || latest.status === 'AUTHORIZED');
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await fetchPaymentStatus(paymentId, expectedReference);
  }
  if (latest.status === 'CAPTURED' || latest.status === 'FAILED' || latest.status === 'EXPIRED') {
    if (latest.referenceType === 'APPOINTMENT' && appointmentCustomerId) {
      await clearPendingAppointmentPayment(appointmentCustomerId, paymentId);
    } else if (latest.referenceType !== 'APPOINTMENT') {
      await clearPendingPayment(paymentId);
    }
  }
  return latest;
}
