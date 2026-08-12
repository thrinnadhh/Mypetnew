import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OrderFlowStepId } from '@/constants/content';
import type { CustomerOrderPaymentStatus, CustomerPaymentMethod } from '@/contracts/customer-payment';
import type { OrderStatus } from '@/contracts/order-contract.generated';
import { fetchDeliveryContact } from '@/services/customer-profile';
import { appConfig } from '@/utils/app-config';

export type OrderTabCategory = 'active' | 'past' | 'subscription';

export interface CustomerOrderRecord {
  id: string;
  providerId: string;
  providerName: string;
  providerType?: string | null;
  items: string[];
  total: string;
  rawTotal: number;
  status: OrderStatus;
  orderedAt: string;
  hasReview: boolean;
  flowStep: OrderFlowStepId;
  paymentMethod?: CustomerPaymentMethod | string | null;
  paymentStatus?: CustomerOrderPaymentStatus | null;
  isSubscription?: boolean;
  deliveryAddressId?: string;
  deliveryAddress?: {
    label?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
    latitude: number;
    longitude: number;
  };
  deliveryContactPhone?: string | null;
  deliveryContactVerified?: boolean;
  captainId?: string;
  captainAssignedAt?: string | null;
  etaMinutes?: number | null;
  deliveryStatus?: string | null;
  invoiceNumber?: string | null;
  statusHistory?: Array<{
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    changedAt: string;
    note: string | null;
  }>;
}

export interface ReorderItemValidation {
  offeringId: string;
  offeringName: string;
  unitPrice: number;
  quantity: number;
  isAvailable: boolean;
  message?: string | null;
}

export interface ReorderValidationResult {
  originalOrderId: string;
  providerId: string;
  isProviderServiceable: boolean;
  items: ReorderItemValidation[];
  canReorder: boolean;
}

type CanonicalCaptainDto = {
  captainId: string;
  assignedAt?: string | null;
};

interface OrderTrackingDto {
  orderId: string;
  providerId: string;
  providerName?: string;
  status: OrderStatus;
  flowStep?: OrderFlowStepId;
  totalAmount: number | string;
  placedAt: string;
  items?: string[] | null;
  paymentMethod?: string | null;
  paymentStatus?: CustomerOrderPaymentStatus | null;
  captain?: CanonicalCaptainDto | null;
  etaMinutes?: number | null;
  deliveryStatus?: string | null;
  statusHistory?: CustomerOrderRecord['statusHistory'];
}

interface CustomerOrderDetailResponse {
  orderId: string;
  provider: {
    providerId: string;
    name: string;
    providerType: string;
  };
  items: Array<{
    orderItemId: string;
    offeringId: string;
    name: string;
    unitPrice: number | string;
    quantity: number;
    lineTotal: number | string;
  }>;
  pricing: {
    subtotal: number | string;
    discount: number | string;
    loyaltyDiscount: number | string;
    delivery: number | string;
    tax: number | string;
    total: number | string;
  };
  payment: {
    method: string;
    status: CustomerOrderPaymentStatus;
    paymentId?: string | null;
  };
  status: OrderStatus;
  flowStep: OrderFlowStepId;
  statusHistory: CustomerOrderRecord['statusHistory'];
  deliveryAddress: {
    addressId: string;
    label?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
    latitude: number;
    longitude: number;
  };
  deliveryContact: {
    phone?: string | null;
    verified: boolean;
  };
  captain?: CanonicalCaptainDto | null;
  timestamps: {
    placedAt: string;
    acceptedAt?: string | null;
    preparingAt?: string | null;
    readyAt?: string | null;
    pickedUpAt?: string | null;
    deliveredAt?: string | null;
    cancelledAt?: string | null;
  };
  cancellation: {
    cancelled: boolean;
    reason?: string | null;
    cancelledAt?: string | null;
  };
  invoice?: {
    invoiceId: string;
    invoiceNumber: string;
    subtotal: number | string;
    tax: number | string;
    total: number | string;
    generatedAt: string;
  } | null;
}

interface LegacyOrderDetailsDto {
  orderId?: string;
  id?: string;
  providerId: string;
  totalAmount: number | string;
  status: OrderStatus;
  placedAt?: string;
  createdAt?: string;
  items?: Array<{ offeringNameSnapshot?: string; name?: string }>;
  flowStep?: OrderFlowStepId;
  paymentMethod?: string | null;
  paymentStatus?: CustomerOrderPaymentStatus | null;
  deliveryAddressId?: string;
  deliveryContactPhone?: string | null;
  deliveryContactVerified?: boolean;
  captainId?: string;
  statusHistory?: CustomerOrderRecord['statusHistory'];
}

type CreatedOrderDto = CustomerOrderDetailResponse | LegacyOrderDetailsDto;

class OrderHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const CACHE_PREFIX = '@mypet_orders_cache_v2_';

function headers(accessToken?: string | null): Record<string, string> {
  const result: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) result.Authorization = `Bearer ${accessToken}`;
  return result;
}

async function responseError(response: Response, fallback: string): Promise<OrderHttpError> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new OrderHttpError(response.status, body?.message || body?.error || fallback);
}

function isOfflineFailure(error: unknown): boolean {
  if (error instanceof OrderHttpError) return false;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('network') || message.includes('fetch') || message.includes('offline');
}

function isCanonicalOrder(value: CreatedOrderDto): value is CustomerOrderDetailResponse {
  return 'provider' in value && 'pricing' in value && 'payment' in value && 'timestamps' in value;
}

function canonicalToRecord(order: CustomerOrderDetailResponse): CustomerOrderRecord {
  const rawTotal = Number(order.pricing.total) || 0;
  return {
    id: order.orderId,
    providerId: order.provider.providerId,
    providerName: order.provider.name,
    providerType: order.provider.providerType,
    items: order.items.map((item) => item.name),
    total: `₹${rawTotal.toFixed(0)}`,
    rawTotal,
    status: order.status,
    orderedAt: order.timestamps.placedAt,
    hasReview: false,
    flowStep: order.flowStep,
    paymentMethod: order.payment.method,
    paymentStatus: order.payment.status,
    deliveryAddressId: order.deliveryAddress.addressId,
    deliveryAddress: {
      label: order.deliveryAddress.label,
      line1: order.deliveryAddress.line1,
      line2: order.deliveryAddress.line2,
      city: order.deliveryAddress.city,
      state: order.deliveryAddress.state,
      pincode: order.deliveryAddress.pincode,
      latitude: order.deliveryAddress.latitude,
      longitude: order.deliveryAddress.longitude,
    },
    deliveryContactPhone: order.deliveryContact.phone,
    deliveryContactVerified: order.deliveryContact.verified,
    captainId: order.captain?.captainId,
    captainAssignedAt: order.captain?.assignedAt,
    invoiceNumber: order.invoice?.invoiceNumber,
    statusHistory: order.statusHistory || [],
  };
}

async function providerName(providerId: string, accessToken?: string | null): Promise<string> {
  // Legacy-protocol compatibility only. Sprint 4 tracking/detail responses carry provider truth server-side.
  try {
    const response = await fetch(
      `${appConfig.apiBaseUrl}/api/v1/providers/${encodeURIComponent(providerId)}`,
      { headers: headers(accessToken) },
    );
    if (!response.ok) return `Store ${providerId.slice(0, 8)}`;
    const body = (await response.json()) as { name?: string };
    return body.name?.trim() || `Store ${providerId.slice(0, 8)}`;
  } catch {
    return `Store ${providerId.slice(0, 8)}`;
  }
}

export async function fetchCustomerOrders(customerId: string, accessToken?: string | null): Promise<CustomerOrderRecord[]> {
  const cacheKey = `${CACHE_PREFIX}${customerId}`;
  try {
    const response = await fetch(
      `${appConfig.apiBaseUrl}/api/v1/orders/customer/${encodeURIComponent(customerId)}/tracking`,
      { headers: headers(accessToken) },
    );
    if (!response.ok) throw await responseError(response, 'Could not load order history');
    const rawOrders = (await response.json()) as OrderTrackingDto[];
    const orders: CustomerOrderRecord[] = await Promise.all(rawOrders.map(async (order) => {
      const rawTotal = Number(order.totalAmount) || 0;
      const canonicalProviderName = order.providerName?.trim();
      const resolvedProviderName = canonicalProviderName || await providerName(order.providerId, accessToken);
      return {
        id: order.orderId,
        providerId: order.providerId,
        providerName: resolvedProviderName,
        items: Array.isArray(order.items) ? order.items : ['Pet Item'],
        total: `₹${rawTotal.toFixed(0)}`,
        rawTotal,
        status: order.status,
        orderedAt: order.placedAt,
        hasReview: false,
        flowStep: order.flowStep || 'placed',
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        captainId: order.captain?.captainId,
        captainAssignedAt: order.captain?.assignedAt,
        etaMinutes: order.etaMinutes,
        deliveryStatus: order.deliveryStatus,
        statusHistory: order.statusHistory || [],
      };
    }));
    await AsyncStorage.setItem(cacheKey, JSON.stringify(orders)).catch(() => null);
    return orders;
  } catch (error) {
    if (!isOfflineFailure(error)) throw error;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CustomerOrderRecord[];
        if (Array.isArray(parsed)) return parsed;
      } catch {
        await AsyncStorage.removeItem(cacheKey).catch(() => null);
      }
    }
    throw error;
  }
}

export async function fetchOrderDetails(orderId: string, accessToken?: string | null): Promise<CustomerOrderRecord> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/orders/${encodeURIComponent(orderId)}`, { headers: headers(accessToken) });
  if (!response.ok) throw await responseError(response, 'Could not load order details');
  const order = (await response.json()) as CreatedOrderDto;
  if (isCanonicalOrder(order)) return canonicalToRecord(order);

  const rawTotal = Number(order.totalAmount) || 0;
  const resolvedOrderId = order.orderId || order.id;
  if (!resolvedOrderId) throw new Error('Order service returned an invalid order ID');
  return {
    id: resolvedOrderId,
    providerId: order.providerId,
    providerName: await providerName(order.providerId, accessToken),
    items: order.items?.map((item) => item.offeringNameSnapshot || item.name || 'Pet Item') || ['Pet Item'],
    total: `₹${rawTotal.toFixed(0)}`,
    rawTotal,
    status: order.status,
    orderedAt: order.placedAt || order.createdAt || new Date().toISOString(),
    hasReview: false,
    flowStep: order.flowStep || 'placed',
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    deliveryAddressId: order.deliveryAddressId,
    deliveryContactPhone: order.deliveryContactPhone,
    deliveryContactVerified: order.deliveryContactVerified,
    captainId: order.captainId,
    statusHistory: order.statusHistory || [],
  };
}

export async function cancelOrder(orderId: string, reason: string, accessToken?: string | null): Promise<void> {
  const url = `${appConfig.apiBaseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/cancel?reason=${encodeURIComponent(reason)}`;
  const response = await fetch(url, { method: 'POST', headers: headers(accessToken) });
  if (!response.ok) throw await responseError(response, 'Could not cancel order');
}

export async function reorderItems(orderId: string, accessToken?: string | null): Promise<ReorderValidationResult> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/reorder`, {
    method: 'POST', headers: headers(accessToken),
  });
  if (!response.ok) throw await responseError(response, 'Reorder revalidation failed');
  return (await response.json()) as ReorderValidationResult;
}

export interface CheckoutQuoteInput {
  customerId: string;
  providerId: string;
  deliveryAddressId: string;
  items: Array<{ offeringId: string; quantity: number }>;
  couponCode?: string | null;
  loyaltyRewardId?: string | null;
  paymentMethod?: CustomerPaymentMethod | string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CheckoutQuoteOutput {
  quoteToken: string;
  subtotal: number;
  itemDiscount: number;
  couponDiscount: number;
  loyaltyDiscount: number;
  deliveryFee: number;
  tax: number;
  roundOff: number;
  payableTotal: number;
  couponCode?: string | null;
  paymentMethod?: string | null;
  isCodAvailable: boolean;
  codRejectionReason?: string | null;
  expiresAt: string;
}

export interface CreateOrderInput extends CheckoutQuoteInput {
  quoteToken?: string | null;
}

export async function fetchCheckoutQuote(input: CheckoutQuoteInput, accessToken?: string | null): Promise<CheckoutQuoteOutput> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/checkout/quote`, {
    method: 'POST',
    headers: { ...headers(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response, 'Could not calculate checkout quote');
  return (await response.json()) as CheckoutQuoteOutput;
}

export async function createCustomerOrder(input: CreateOrderInput, accessToken?: string | null): Promise<CustomerOrderRecord> {
  if (!accessToken) throw new Error('Sign in before placing an order.');
  if (!input.quoteToken) {
    throw new Error('Checkout has an invalid response because the quote is missing. Request a fresh checkout quote before placing the order.');
  }
  const contact = await fetchDeliveryContact(accessToken, input.deliveryAddressId);
  if (!contact?.phoneNumber) throw new Error('Add a delivery contact number to this address before placing your order.');

  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/orders`, {
    method: 'POST',
    headers: {
      ...headers(accessToken),
      'Content-Type': 'application/json',
      'X-Delivery-Contact-Phone': contact.phoneNumber,
      'X-Idempotency-Key': `checkout:${input.quoteToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response, 'Could not place order');

  const order = (await response.json()) as CreatedOrderDto;
  if (isCanonicalOrder(order)) return canonicalToRecord(order);

  const orderId = typeof order.orderId === 'string' ? order.orderId : order.id;
  if (typeof orderId !== 'string' || typeof order.providerId !== 'string') throw new Error('Order service returned an invalid response');
  const rawTotal = Number(order.totalAmount) || 0;
  return {
    id: orderId,
    providerId: order.providerId,
    providerName: await providerName(order.providerId, accessToken),
    items: order.items?.map((item) => item.offeringNameSnapshot || item.name || 'Pet Product') || ['Pet Product'],
    total: `₹${rawTotal.toFixed(0)}`,
    rawTotal,
    status: order.status,
    orderedAt: order.placedAt || new Date().toISOString(),
    hasReview: false,
    flowStep: order.flowStep || 'placed',
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    deliveryAddressId: order.deliveryAddressId,
    deliveryContactPhone: order.deliveryContactPhone,
    deliveryContactVerified: order.deliveryContactVerified,
  };
}
