import { apiClient } from '@/services/api-client';

export interface CustomerProfile {
  accountId: string;
  name: string | null;
  mobile: string;
  email: string | null;
  profileCompletion: number;
}

export interface CustomerAddress {
  addressId: string;
  label: string;
  recipientName: string;
  phoneNumber: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryContact {
  addressId: string;
  phoneNumber: string;
}

export interface AddressInput {
  label: string;
  recipientName: string;
  phoneNumber: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}

/** Compatibility shape for old tests/importers. The active Profile screen does not use precise coordinates. */
export interface LegacyDefaultAddressInput {
  label?: string;
  recipientName?: string;
  phoneNumber?: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  geoLat?: number;
  geoLng?: number;
}

export type LegacyDefaultAddress = CustomerAddress & { geoLat?: number; geoLng?: number };

export interface ServiceabilityResponse {
  serviceable: boolean;
  fulfilmentMode: 'STORE_PICKUP' | 'MYPET_CAPTAIN_DELIVERY';
  reasonCode: string;
}

const authHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export function normalizeDeliveryPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return `+${digits}`;
  throw new Error('Enter a valid 10-digit Indian mobile number.');
}

export async function fetchCustomerProfile(accessToken: string): Promise<CustomerProfile> {
  return apiClient.get<CustomerProfile>('/api/v1/customer/profile', authHeaders(accessToken));
}

export async function updateCustomerProfile(
  accessToken: string,
  input: { name?: string | null; email?: string | null },
): Promise<CustomerProfile> {
  return apiClient.patch<CustomerProfile>('/api/v1/customer/profile', input, authHeaders(accessToken));
}

export async function fetchCustomerAddresses(accessToken: string): Promise<CustomerAddress[]> {
  return apiClient.get<CustomerAddress[]>('/api/v1/customer/addresses', authHeaders(accessToken));
}

export async function createCustomerAddress(
  accessToken: string,
  input: AddressInput,
): Promise<CustomerAddress> {
  return apiClient.post<CustomerAddress>(
    '/api/v1/customer/addresses',
    { ...input, phoneNumber: normalizeDeliveryPhone(input.phoneNumber) },
    authHeaders(accessToken),
  );
}

export async function updateCustomerAddress(
  accessToken: string,
  addressId: string,
  input: AddressInput,
): Promise<CustomerAddress> {
  return apiClient.patch<CustomerAddress>(
    `/api/v1/customer/addresses/${encodeURIComponent(addressId)}`,
    { ...input, phoneNumber: normalizeDeliveryPhone(input.phoneNumber) },
    authHeaders(accessToken),
  );
}

export async function deleteCustomerAddress(accessToken: string, addressId: string): Promise<void> {
  await apiClient.delete<void>(
    `/api/v1/customer/addresses/${encodeURIComponent(addressId)}`,
    authHeaders(accessToken),
  );
}

export async function fetchDeliveryContact(
  accessToken: string,
  addressId: string,
): Promise<DeliveryContact | null> {
  const addresses = await fetchCustomerAddresses(accessToken);
  const address = addresses.find((item) => item.addressId === addressId);
  return address ? { addressId: address.addressId, phoneNumber: address.phoneNumber } : null;
}

export async function saveDeliveryContact(
  accessToken: string,
  addressId: string,
  rawPhoneNumber: string,
): Promise<DeliveryContact> {
  const addresses = await fetchCustomerAddresses(accessToken);
  const address = addresses.find((item) => item.addressId === addressId);
  if (!address) throw new Error('Address not found.');
  const updated = await updateCustomerAddress(accessToken, addressId, {
    label: address.label,
    recipientName: address.recipientName,
    phoneNumber: normalizeDeliveryPhone(rawPhoneNumber),
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  });
  return { addressId: updated.addressId, phoneNumber: updated.phoneNumber };
}

function normalizeLegacyAddress(value: LegacyDefaultAddress): LegacyDefaultAddress {
  const geoLat = value.geoLat == null ? undefined : Number(value.geoLat);
  const geoLng = value.geoLng == null ? undefined : Number(value.geoLng);
  return { ...value, geoLat, geoLng };
}

export async function fetchDefaultAddress(accessToken: string): Promise<LegacyDefaultAddress | null> {
  try {
    const response = await apiClient.get<CustomerAddress[] | LegacyDefaultAddress>(
      '/api/v1/customer/addresses',
      authHeaders(accessToken),
    );
    if (!Array.isArray(response)) return normalizeLegacyAddress(response);
    const address = response.find((item) => item.isDefault) ?? response[0] ?? null;
    return address;
  } catch (error) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

export async function saveDefaultAddress(
  accessToken: string,
  input: AddressInput,
  existingAddressId?: string | null,
): Promise<CustomerAddress> {
  const payload = { ...input, isDefault: true };
  return existingAddressId
    ? updateCustomerAddress(accessToken, existingAddressId, payload)
    : createCustomerAddress(accessToken, payload);
}

/** @deprecated Use createCustomerAddress/saveDefaultAddress with recipient and phone. */
export async function createDefaultAddress(
  accessToken: string,
  input: LegacyDefaultAddressInput,
): Promise<LegacyDefaultAddress> {
  const { geoLat: _geoLat, geoLng: _geoLng, ...canonical } = input;
  try {
    const response = await apiClient.post<LegacyDefaultAddress>(
      '/api/v1/customer/addresses',
      { ...canonical, isDefault: true },
      authHeaders(accessToken),
    );
    return normalizeLegacyAddress(response);
  } catch (error) {
    if (
      (error as { status?: number })?.status === 500 &&
      error instanceof Error &&
      error.message === 'Request failed (500)'
    ) {
      throw new Error('ADDRESS_500');
    }
    throw error;
  }
}

export async function checkOutletServiceability(
  outletId: string,
  pincode: string,
  mode: 'DELIVERY' | 'PICKUP' = 'DELIVERY',
): Promise<ServiceabilityResponse> {
  if (!/^[1-9]\d{5}$/.test(pincode)) throw new Error('Enter a valid six-digit PIN code.');
  return apiClient.get<ServiceabilityResponse>(
    `/api/v1/public/outlets/${encodeURIComponent(outletId)}/serviceability?pincode=${encodeURIComponent(pincode)}&mode=${mode}`,
  );
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
