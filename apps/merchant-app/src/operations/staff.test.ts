import { merchantApiFetch } from '../auth/session';
import {
  canManagePermission,
  canManageStaff,
  fetchStaffGrants,
  grantStaffPermission,
  revokeStaffPermission,
} from './staff';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => fetchMock.mockReset());

describe('M11 staff permission gating and API', () => {
  const accountId = '5e1b20ac-3cc0-4180-aa91-3b7eeb447ccb';

  it('allows owners and outlet managers while reserving OWNER mutation for owners', () => {
    expect(canManageStaff(['OWNER'])).toBe(true);
    expect(canManageStaff(['OUTLET_MANAGE'])).toBe(true);
    expect(canManageStaff(['CATALOG_WRITE'])).toBe(false);
    expect(canManagePermission(['OWNER'], 'OWNER')).toBe(true);
    expect(canManagePermission(['OUTLET_MANAGE'], 'OWNER')).toBe(false);
    expect(canManagePermission(['OUTLET_MANAGE'], 'CATALOG_WRITE')).toBe(true);
  });

  it('lists, grants and revokes exact outlet permissions without sending organization authority', async () => {
    fetchMock.mockResolvedValueOnce(response(true, { items: [], page: 0, pageSize: 100, hasNext: false }));
    await fetchStaffGrants('outlet-1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/merchant/staff?outletId=outlet-1&page=0&pageSize=100');

    const grant = {
      accountId,
      outletId: 'outlet-1',
      permission: 'CATALOG_WRITE',
      active: true,
      accountStatus: 'ACTIVE',
    };
    fetchMock.mockResolvedValueOnce(response(true, grant));
    await grantStaffPermission('outlet-1', accountId, 'CATALOG_WRITE');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/merchant/staff/grants', {
      method: 'POST',
      body: JSON.stringify({ outletId: 'outlet-1', accountId, permission: 'CATALOG_WRITE' }),
    });
    expect(fetchMock.mock.calls[1][1]?.body).not.toContain('organization');
    expect(fetchMock.mock.calls[1][1]?.body).not.toContain('mobileE164');

    fetchMock.mockResolvedValueOnce(response(true, { ...grant, active: false }));
    await revokeStaffPermission('outlet-1', accountId, 'CATALOG_WRITE');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v1/merchant/staff/${accountId}/permissions/CATALOG_WRITE`,
      { method: 'DELETE', body: JSON.stringify({ outletId: 'outlet-1' }) },
    );
  });

  it('rejects mobile and malformed targets before making a grant request', async () => {
    await expect(grantStaffPermission('outlet-1', '+919876543210', 'CATALOG_WRITE')).rejects.toMatchObject({
      name: 'MERCHANT_ACCOUNT_ID_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
