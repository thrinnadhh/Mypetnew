const EMPTY_VALUE = '—';

function validDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCurrency(
  value: number | null | undefined,
  options: { locale?: string; currency?: string; maximumFractionDigits?: number } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat(options.locale ?? 'en-IN', {
    style: 'currency',
    currency: options.currency ?? 'INR',
    maximumFractionDigits: options.maximumFractionDigits ?? (Number.isInteger(value) ? 0 : 2),
  }).format(value);
}

export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
  locale = 'en-IN',
): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale, options).format(date) : EMPTY_VALUE;
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale = 'en-IN',
): string {
  return formatDate(
    value,
    { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' },
    locale,
  );
}

export function formatTime(
  value: string | number | Date | null | undefined,
  locale = 'en-IN',
): string {
  return formatDate(value, { hour: 'numeric', minute: '2-digit' }, locale);
}

export function formatDistance(metres: number | null | undefined): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres) || metres < 0) return EMPTY_VALUE;
  if (metres < 1000) return `${Math.round(metres)} m`;
  const kilometres = metres / 1000;
  return `${kilometres < 10 ? kilometres.toFixed(1) : Math.round(kilometres)} km`;
}

export function formatPercentage(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatStatusLabel(status: string | null | undefined): string {
  if (!status?.trim()) return EMPTY_VALUE;
  return status
    .trim()
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

const orderLabels: Record<string, string> = {
  CREATED: 'Order placed',
  PENDING_PAYMENT: 'Payment pending',
  PAID: 'Paid',
  ACCEPTED: 'Accepted by store',
  PACKING: 'Packing',
  READY_FOR_PICKUP: 'Ready for pickup',
  CAPTAIN_SEARCH: 'Finding a captain',
  CAPTAIN_ASSIGNED: 'Captain assigned',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

const appointmentLabels: Record<string, string> = {
  HOLD: 'Slot held',
  PENDING: 'Pending confirmation',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  RESCHEDULE_REQUESTED: 'Reschedule requested',
};

const deliveryLabels: Record<string, string> = {
  SEARCHING: 'Finding a captain',
  OFFERED: 'Offer sent',
  ASSIGNED: 'Captain assigned',
  PICKUP_PENDING: 'Pickup pending',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  FAILED: 'Delivery failed',
  CANCELLED: 'Cancelled',
};

function domainStatus(status: string | null | undefined, labels: Record<string, string>): string {
  if (!status?.trim()) return EMPTY_VALUE;
  const normalized = status.trim().toUpperCase();
  return labels[normalized] ?? formatStatusLabel(normalized);
}

export const formatOrderStatus = (status: string | null | undefined) => domainStatus(status, orderLabels);
export const formatAppointmentStatus = (status: string | null | undefined) => domainStatus(status, appointmentLabels);
export const formatDeliveryStatus = (status: string | null | undefined) => domainStatus(status, deliveryLabels);
