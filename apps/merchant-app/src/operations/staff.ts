import { merchantApiFetch } from '../auth/session';

export type MerchantPermission =
  | 'OWNER'
  | 'OUTLET_MANAGE'
  | 'CATALOG_WRITE'
  | 'INVENTORY_WRITE'
  | 'ORDER_FULFIL'
  | 'POS_OPERATE'
  | 'LOYALTY_OPERATE';

export const MERCHANT_PERMISSIONS: readonly MerchantPermission[] = [
  'OWNER',
  'OUTLET_MANAGE',
  'CATALOG_WRITE',
  'INVENTORY_WRITE',
  'ORDER_FULFIL',
  'POS_OPERATE',
  'LOYALTY_OPERATE',
];

export const STAFF_PERMISSIONS = MERCHANT_PERMISSIONS;

export type StaffGrant = {
  accountId: string;
  outletId: string;
  permission: MerchantPermission;
  active: boolean;
  accountStatus: string;
};

export type MerchantStaffGrant = StaffGrant;

export type StaffGrantPage = {
  items: StaffGrant[];
  page: number;
  pageSize: number;
  hasNext: boolean;
};

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  const error = new Error(body?.message ?? fallback);
  error.name = body?.code ?? 'MERCHANT_API_ERROR';
  return error;
}

export function canManageStaff(permissions: readonly string[]): boolean {
  return permissions.includes('OWNER') || permissions.includes('OUTLET_MANAGE');
}

export function canManagePermission(
  actorPermissions: readonly string[],
  permission: MerchantPermission,
): boolean {
  if (!canManageStaff(actorPermissions)) return false;
  return permission !== 'OWNER' || actorPermissions.includes('OWNER');
}

export async function fetchStaffGrants(
  outletId: string,
  page = 0,
  pageSize = 100,
): Promise<StaffGrant[]> {
  const params = new URLSearchParams({ outletId, page: String(page), pageSize: String(pageSize) });
  const response = await merchantApiFetch(`/api/v1/merchant/staff?${params.toString()}`);
  if (!response.ok) throw await apiError(response, 'Could not load staff grants.');
  return ((await response.json()) as StaffGrantPage).items;
}

export async function grantStaffPermission(
  outletId: string,
  accountId: string,
  permission: MerchantPermission,
): Promise<StaffGrant> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
    const error = new Error('A valid Merchant account ID is required.');
    error.name = 'MERCHANT_ACCOUNT_ID_INVALID';
    throw error;
  }
  const response = await merchantApiFetch('/api/v1/merchant/staff/grants', {
    method: 'POST',
    body: JSON.stringify({ outletId, accountId, permission }),
  });
  if (!response.ok) throw await apiError(response, 'Could not grant this permission.');
  return (await response.json()) as StaffGrant;
}

export async function revokeStaffPermission(
  outletId: string,
  accountId: string,
  permission: MerchantPermission,
): Promise<StaffGrant> {
  const response = await merchantApiFetch(
    `/api/v1/merchant/staff/${encodeURIComponent(accountId)}/permissions/${encodeURIComponent(permission)}`,
    { method: 'DELETE', body: JSON.stringify({ outletId }) },
  );
  if (!response.ok) throw await apiError(response, 'Could not revoke this permission.');
  return (await response.json()) as StaffGrant;
}
