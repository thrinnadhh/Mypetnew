import fs from 'node:fs';
import path from 'node:path';

const contextPath = path.join(__dirname, '..', 'context', 'FavouritesContext.tsx');
const privacyPath = path.join(__dirname, '..', 'app', 'privacy.tsx');
const source = fs.readFileSync(contextPath, 'utf8');
const privacySource = fs.readFileSync(privacyPath, 'utf8');

describe('P3 canonical favourites contract', () => {
  it('uses the listing-owned paginated Customer favourites API', () => {
    expect(source).toContain('/api/v1/customer/favourites?page=${page}&pageSize=100');
    expect(source).toContain('/api/v1/customer/favourites/${encodeURIComponent(listingId)}');
    expect(source).toContain('/api/v1/customer/favourites/${encodeURIComponent(targetId)}');
    expect(source).toContain("method: 'PUT'");
    expect(source).toContain("method: 'DELETE'");
  });

  it('does not restore the legacy generic POST or query-parameter deletion contract', () => {
    expect(source).not.toContain("method: 'POST'");
    expect(source).not.toContain('targetType=${encodeURIComponent');
    expect(source).not.toContain('targetId=${encodeURIComponent');
    expect(source).not.toContain('body: JSON.stringify({ targetType');
  });

  it('migrates the prior guest storage key instead of orphaning saved preferences', () => {
    expect(source).toContain("const LEGACY_STORAGE_KEY = 'mypet_favourites_v2_guest'");
    expect(source).toContain('AsyncStorage.removeItem(LEGACY_STORAGE_KEY)');
  });

  it('erases local favourite preferences after successful account deletion', () => {
    expect(source).toContain('export async function clearLocalFavourites');
    expect(source).toContain('AsyncStorage.multiRemove([STORAGE_KEY, LEGACY_STORAGE_KEY])');
    expect(privacySource).toContain('await deleteCustomerAccount();');
    expect(privacySource).toContain('await clearLocalFavourites().catch');
  });

  it('keeps outlet favourites local until an outlet-owned server contract exists', () => {
    expect(source).toContain("if (targetType === 'SHOP')");
    expect(source).not.toContain("targetType: 'SHOP', targetId: body");
  });
});
