import { appConfig } from '@/utils/app-config';

export interface CustomerAddress {
  addressId: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  geoLat: number;
  geoLng: number;
  isDefault: boolean;
}

export interface DeliveryContact {
  addressId: string;
  phoneNumber: string;
}

export interface AddressInput {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  geoLat: number;
  geoLng: number;
}

const authHeaders = (accessToken: string) => ({
  Accept: 'application/json',
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

async function addressError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `ADDRESS_${response.status}`);
}

function normalizeAddress(
  value: Omit<CustomerAddress, 'geoLat' | 'geoLng'> & {
    geoLat: number | string;
    geoLng: number | string;
  },
): CustomerAddress {
  return { ...value, geoLat: Number(value.geoLat), geoLng: Number(value.geoLng) };
}

export function normalizeDeliveryPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return `+${digits}`;
  throw new Error('Enter a valid 10-digit Indian mobile number.');
}

export async function fetchDefaultAddress(accessToken: string): Promise<CustomerAddress | null> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/addresses/default`, {
    headers: authHeaders(accessToken),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await addressError(response);
  return normalizeAddress(await response.json());
}

export async function createDefaultAddress(
  accessToken: string,
  input: AddressInput,
): Promise<CustomerAddress> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/addresses/default`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ ...input, isDefault: true }),
  });
  if (!response.ok) throw await addressError(response);
  return normalizeAddress(await response.json());
}

export async function fetchDeliveryContact(
  accessToken: string,
  addressId: string,
): Promise<DeliveryContact | null> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/addresses/${encodeURIComponent(addressId)}/contact`,
    { headers: authHeaders(accessToken) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await addressError(response);
  return (await response.json()) as DeliveryContact;
}

export async function saveDeliveryContact(
  accessToken: string,
  addressId: string,
  rawPhoneNumber: string,
): Promise<DeliveryContact> {
  const phoneNumber = normalizeDeliveryPhone(rawPhoneNumber);
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/addresses/${encodeURIComponent(addressId)}/contact`,
    {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ phoneNumber }),
    },
  );
  if (!response.ok) throw await addressError(response);
  return (await response.json()) as DeliveryContact;
}

export function isOfflineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('offline') ||
    message.includes('failed to connect')
  );
}
