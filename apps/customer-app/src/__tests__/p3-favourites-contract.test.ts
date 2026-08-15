import fs from 'node:fs';
import path from 'node:path';

const contextPath = path.join(__dirname, '..', 'context', 'FavouritesContext.tsx');
const source = fs.readFileSync(contextPath, 'utf8');

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

  it('keeps outlet favourites local until an outlet-owned server contract exists', () => {
    expect(source).toContain("targetType === 'SHOP'");
    expect(source).toContain('Shop favourites are intentionally local');
  });
});
