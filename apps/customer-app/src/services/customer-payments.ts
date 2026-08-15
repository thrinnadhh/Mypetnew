import * as WebBrowser from 'expo-web-browser';

import type { CustomerPaymentStatus } from '../contracts/customer-payment';
import { appConfig } from '../utils/app-config';
import { apiClient } from './api-client';

export interface CashfreeOrderInitialization {
  orderId: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
  transactionId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
}

export interface HostedCheckoutSession {
  checkoutPath: string;
  expiresAt: string;
}

export interface CustomerPaymentStatusView {
  transactionId: string;
  referenceId: string;
  transactionType: string;
  amount: number;
  currency: string;
  status: CustomerPaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CashfreeCustomerDetails {
  phone: string;
  email?: string | null;
  name?: string | null;
}

function normalizedPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(-10);
  if (digits.length === 10) return digits;
  throw new Error('Add a valid Indian mobile number before paying online.');
}

function paymentPayload(
  userId: string,
  referenceId: string,
  amount: number,
  transactionType: 'ORDER_PAYMENT' | 'APPOINTMENT_PAYMENT',
  customer: CashfreeCustomerDetails,
) {
  return {
    userId,
    referenceId,
    amount,
    transactionType,
    customerPhone: normalizedPhone(customer.phone),
    customerEmail: customer.email?.trim() || null,
    customerName: customer.name?.trim() || null,
  };
}

export async function initiateOrderPayment(
  userId: string,
  orderId: string,
  amount: number,
  customer: CashfreeCustomerDetails,
): Promise<CashfreeOrderInitialization> {
  let paymentCustomer = customer;
  if (!customer.phone.trim()) {
    const order = await apiClient.get<{ deliveryContactPhone?: string | null }>(
      `/api/v1/orders/${encodeURIComponent(orderId)}`,
    );
    paymentCustomer = { ...customer, phone: order.deliveryContactPhone ?? '' };
  }
  return apiClient.post<CashfreeOrderInitialization>(
    '/api/v1/payments/orders',
    paymentPayload(userId, orderId, amount, 'ORDER_PAYMENT', paymentCustomer),
  );
}

export async function initiateAppointmentPayment(
  userId: string,
  appointmentId: string,
  amount: number,
  customer: CashfreeCustomerDetails,
): Promise<CashfreeOrderInitialization> {
  return apiClient.post<CashfreeOrderInitialization>(
    '/api/v1/payments/appointments',
    paymentPayload(userId, appointmentId, amount, 'APPOINTMENT_PAYMENT', customer),
  );
}

export async function createHostedCheckoutSession(transactionId: string): Promise<HostedCheckoutSession> {
  return apiClient.post<HostedCheckoutSession>('/api/v1/payments/checkout-sessions', { transactionId });
}

export async function fetchReferencePaymentStatus(referenceId: string): Promise<CustomerPaymentStatusView> {
  return apiClient.get<CustomerPaymentStatusView>(
    `/api/v1/payments/transactions/reference/${encodeURIComponent(referenceId)}`,
  );
}

export async function fetchOrderPaymentStatus(orderId: string): Promise<CustomerPaymentStatusView> {
  return fetchReferencePaymentStatus(orderId);
}

export async function openCashfreeOrder(initialization: CashfreeOrderInitialization): Promise<void> {
  if (!initialization.paymentSessionId || !initialization.orderId) {
    throw new Error('Cashfree returned an invalid checkout session.');
  }
  const session = await createHostedCheckoutSession(initialization.transactionId);
  const baseUrl = (appConfig.apiBaseUrl || 'http://localhost:8080').replace(/\/+$/, '');
  const checkoutUrl = session.checkoutPath.startsWith('http')
    ? session.checkoutPath
    : `${baseUrl}/${session.checkoutPath.replace(/^\/+/, '')}`;
  await WebBrowser.openAuthSessionAsync(checkoutUrl, 'customerapp://payments/result', {
    showInRecents: true,
    preferEphemeralSession: true,
  });
}

/**
 * Payment reconciliation is server-owned. The customer app only observes the
 * status produced by Cashfree webhook -> PaymentService -> owning domain.
 */
export async function waitForReferencePaymentOutcome(
  referenceId: string,
  attempts = 15,
  delayMs = 2_000,
): Promise<CustomerPaymentStatusView> {
  let latest = await fetchReferencePaymentStatus(referenceId);
  for (let attempt = 1; attempt < attempts && latest.status === 'PENDING'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await fetchReferencePaymentStatus(referenceId);
  }
  return latest;
}

export async function waitForPaymentOutcome(
  orderId: string,
  attempts = 15,
  delayMs = 2_000,
): Promise<CustomerPaymentStatusView> {
  return waitForReferencePaymentOutcome(orderId, attempts, delayMs);
}
