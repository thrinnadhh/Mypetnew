import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('P4 commerce completion contract', () => {
  it('uses canonical routes and redirects legacy commerce aliases', () => {
    const shopAlias = source('src/app/shop.tsx');
    const commerceAlias = source('src/app/commerce/[slug].tsx');
    const commerceIndex = source('src/app/commerce/index.tsx');
    const navigation = source('src/navigation/customer-navigation.ts');

    expect(shopAlias).toContain('<Redirect href="/stores"');
    expect(commerceAlias).toContain('`/category/${canonicalCategory}`');
    expect(commerceAlias).toContain('<Redirect href="/stores"');
    expect(commerceIndex).toContain('<Redirect href="/stores"');
    expect(navigation).toContain("'/products'");
    expect(navigation).toContain("'/category/[id]'");
    expect(navigation).toContain("'/commerce/product-detail'");
    expect(navigation).not.toContain("'/commerce/[slug]'");
  });

  it('keeps category/product discovery bounded and server-authoritative', () => {
    const template = source('src/components/commerce/CategoryTemplate.tsx');
    const products = source('src/app/products/index.tsx');
    const category = source('src/app/category/[id].tsx');

    expect(template).toContain('fetchCommerceCatalogPage');
    expect(template).toContain('CUSTOMER_CATALOG_PAGE_SIZE');
    expect(template).toContain('requestGeneration');
    expect(template).toContain('loadMoreError');
    expect(template).toContain('Retry loading more');
    expect(template).toContain("availability: inStockOnly ? 'IN_STOCK'");
    expect(template).toContain("selectedSort === 'PRICE_ASC'");
    expect(template).toContain('q: debouncedSearch || undefined');
    expect(products).toContain('catalogQuery={{');
    expect(category).toContain('catalogQuery={catalogQueryFor(catKey)}');
    expect(products).not.toContain('fetchCommerceProducts');
    expect(category).not.toContain('fetchAllCatalogItems');
    expect(category).not.toContain('fetchCommerceProducts');
  });

  it('enforces the canonical 48dp controls in commerce templates', () => {
    const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
    const providerTemplate = source('src/components/commerce/ProviderProfileTemplate.tsx');

    expect(categoryTemplate).toContain('minHeight: touchTarget');
    expect(categoryTemplate).toContain('width: touchTarget');
    expect(categoryTemplate).toContain('height: touchTarget');
    expect(categoryTemplate).not.toContain('maxHeight: 36');
    expect(categoryTemplate).not.toContain('height: 44');
    expect(categoryTemplate).not.toContain('width: 36');
    expect(providerTemplate).toContain('favBtn: { width: touchTarget, height: touchTarget');
    expect(providerTemplate).toContain('smallIconBtn: { width: touchTarget, height: touchTarget');
    expect(providerTemplate).toContain('stepTouch: { minWidth: touchTarget, minHeight: touchTarget');
  });

  it('keeps live search product-only, paginated, route-backed and race-safe', () => {
    const search = source('src/screens/search-screen.tsx');

    expect(search).toContain('fetchProductCatalogPage');
    expect(search).toContain('requestGeneration');
    expect(search).toContain('Retry loading more');
    expect(search).toContain('router.setParams({ q: clean })');
    expect(search).toContain('onSubmitEditing={submitSearch}');
    expect(search).not.toContain('fetchAllCatalogItems');
    expect(search).not.toContain('fetchAllPublicOutlets');
    expect(search).not.toContain("type === 'PET_SHOP'");
  });

  it('loads shop product pages incrementally and rejects non-product outlets', () => {
    const shop = source('src/app/shop/[id].tsx');
    const provider = source('src/components/commerce/ProviderProfileTemplate.tsx');

    expect(shop).toContain("outlet.capabilities.includes('PRODUCT_STORE')");
    expect(shop).toContain('fetchProductCatalogPage');
    expect(shop).toContain('CUSTOMER_CATALOG_PAGE_SIZE');
    expect(shop).toContain('loadMoreError');
    expect(provider).toContain('No products available');
    expect(provider).toContain('Load more products');
    expect(provider).toContain('onBack={goBack}');
  });

  it('distinguishes invalid categories and preserves view-only medicines', () => {
    const category = source('src/app/category/[id].tsx');
    const template = source('src/components/commerce/CategoryTemplate.tsx');

    expect(category).toContain('Category unavailable');
    expect(category).toContain("kind: 'MEDICINE'");
    expect(category).toContain("commerceMode: 'VIEW_ONLY'");
    expect(template).toContain("item.kind === 'MEDICINE' || item.commerceMode === 'VIEW_ONLY'");
  });
});
