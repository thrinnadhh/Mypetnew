import fs from 'node:fs';
import path from 'node:path';

const contextPath = path.join(__dirname, '..', 'context', 'FavouritesContext.tsx');
const privacyPath = path.join(__dirname, '..', 'app', 'privacy.tsx');
const source = fs.readFileSync(contextPath, 'utf8');
const privacySource = fs.readFileSync(privacyPath, 'utf8');

describe('P3 canonical favourites contract', () => {
  it('uses the listing-owned paginated Customer favourites API', () => {
    expect(source).toContain('const FAVOURITE_PAGE_SIZE = 50');
    expect(source).toContain('/api/v1/customer/favourites?page=${page}&pageSize=${FAVOURITE_PAGE_SIZE}');
    expect(source).toContain('/api/v1/customer/favourites/${encodeURIComponent(listingId)}');
    expect(source).toContain('/api/v1/customer/favourites/${encodeURIComponent(targetId)}');
    expect(source).toContain('apiClient.put');
    expect(source).toContain('apiClient.delete');
  });

  it('does not restore the legacy generic POST or query-parameter deletion contract', () => {
    expect(source).not.toContain("method: 'POST'");
    expect(source).not.toContain('targetType=${encodeURIComponent');
    expect(source).not.toContain('targetId=${encodeURIComponent');
    expect(source).not.toContain('body: JSON.stringify({ targetType');
  });

  it('keeps guest and authenticated local preference buckets distinct', () => {
    expect(source).toContain("const GUEST_STORAGE_KEY = 'mypet_favourites_v4_guest'");
    expect(source).toContain("const ACCOUNT_STORAGE_PREFIX = 'mypet_favourites_v4_account:'");
    expect(source).toContain('function accountStorageKey(accountId: string)');
    expect(source).toContain('loadAccountLocal(accountAtStart)');
    expect(source).toContain('loadGuestLocal(false)');
  });

  it('migrates only the explicitly guest-owned legacy key and discards ambiguous v3 state', () => {
    expect(source).toContain("const LEGACY_GUEST_STORAGE_KEY = 'mypet_favourites_v2_guest'");
    expect(source).toContain("const AMBIGUOUS_LEGACY_STORAGE_KEY = 'mypet_favourites_v3_local'");
    expect(source).toContain('parseStored(LEGACY_GUEST_STORAGE_KEY)');
    expect(source).not.toContain('parseStored(AMBIGUOUS_LEGACY_STORAGE_KEY)');
    expect(source).toContain('AsyncStorage.multiRemove([LEGACY_GUEST_STORAGE_KEY, AMBIGUOUS_LEGACY_STORAGE_KEY])');
  });

  it('erases guest, legacy and current-account local favourite preferences after account deletion', () => {
    expect(source).toContain('export async function clearLocalFavourites(accountId?: string)');
    expect(source).toContain('if (accountId) keys.push(accountStorageKey(accountId))');
    expect(privacySource).toContain('const deletedAccountId = session.accountId;');
    expect(privacySource).toContain('await deleteCustomerAccount();');
    expect(privacySource).toContain('await clearLocalFavourites(deletedAccountId).catch');
  });

  it('keeps outlet favourites local until an outlet-owned server contract exists', () => {
    expect(source).toContain("if (targetType === 'SHOP')");
    expect(source).toContain("const storageKey = accountAtStart ? accountStorageKey(accountAtStart) : GUEST_STORAGE_KEY");
    expect(source).not.toContain("targetType: 'SHOP', targetId: body");
  });
});
