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

  it('keeps category/product discovery bounded, PIN-scoped and server-authoritative', () => {
    const template = source('src/components/commerce/CategoryTemplate.tsx');
    const products = source('src/app/products/index.tsx');
    const category = source('src/app/category/[id].tsx');
    const service = source('src/services/paginated-catalog.ts');

    expect(template).toContain('fetchCommerceCatalogPage');
    expect(template).toContain('CUSTOMER_CATALOG_PAGE_SIZE');
    expect(template).toContain('requestGeneration');
    expect(template).toContain('loadMoreError');
    expect(template).toContain('Retry loading more');
    expect(template).toContain("availability: inStockOnly ? 'IN_STOCK'");
    expect(template).toContain("selectedSort === 'PRICE_ASC'");
    expect(template).toContain('q: debouncedSearch || undefined');
    expect(products).toContain('catalogQuery={catalogQuery}');
    expect(products).toContain('pincode: selectedPincode');
    expect(category).toContain('catalogQuery={catalogQuery}');
    expect(category).toContain('pincode: selectedPincode');
    expect(service).toContain("['pincode', query.pincode]");
    expect(service).toContain('requireValidServicePincode');
    expect(products).not.toContain('fetchCommerceProducts');
    expect(category).not.toContain('fetchAllCatalogItems');
    expect(category).not.toContain('fetchCommerceProducts');
  });

  it('enforces the canonical 48dp controls in commerce templates', () => {
    const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
    const providerTemplate = source('src/components/commerce/ProviderProfileTemplate.tsx');
    const productDetail = source('src/app/commerce/product-detail.tsx');

    expect(categoryTemplate).toContain('minHeight: touchTarget');
    expect(categoryTemplate).toContain('width: touchTarget');
    expect(categoryTemplate).toContain('height: touchTarget');
    expect(categoryTemplate).not.toContain('maxHeight: 36');
    expect(categoryTemplate).not.toContain('height: 44');
    expect(categoryTemplate).not.toContain('width: 36');
    expect(providerTemplate).toContain('favBtn: { width: touchTarget, height: touchTarget');
    expect(providerTemplate).toContain('smallIconBtn: { width: touchTarget, height: touchTarget');
    expect(providerTemplate).toContain('stepTouch: { minWidth: touchTarget, minHeight: touchTarget');
    expect(productDetail).toContain('width: touchTarget, height: touchTarget');
    expect(productDetail).toContain('minWidth: touchTarget, minHeight: touchTarget');
  });

  it('keeps live search product-only, paginated, route-backed, PIN-scoped and race-safe', () => {
    const search = source('src/screens/search-screen.tsx');

    expect(search).toContain('fetchProductCatalogPage');
    expect(search).toContain('requestGeneration');
    expect(search).toContain('Retry loading more');
    expect(search).toContain('router.setParams({ q: clean })');
    expect(search).toContain('onSubmitEditing={submitSearch}');
    expect(search).toContain('pincode: selectedPincode');
    expect(search).not.toContain('fetchAllCatalogItems');
    expect(search).not.toContain('fetchAllPublicOutlets');
    expect(search).not.toContain("type === 'PET_SHOP'");
  });

  it('loads shop product pages incrementally and rejects non-serviceable product outlets', () => {
    const shop = source('src/app/shop/[id].tsx');
    const provider = source('src/components/commerce/ProviderProfileTemplate.tsx');

    expect(shop).toContain('fetchServiceableProductStore');
    expect(shop).toContain('fetchProductCatalogPage');
    expect(shop).toContain('pincode: selectedPincode');
    expect(shop).toContain('CUSTOMER_CATALOG_PAGE_SIZE');
    expect(shop).toContain('loadMoreError');
    expect(provider).toContain('No products available');
    expect(provider).toContain('Load more products');
    expect(provider).toContain('onBack={goBack}');
  });

  it('uses an explicit selected PIN, fails closed on region failure and paginates store discovery', () => {
    const location = source('src/context/LocationContext.tsx');
    const modal = source('src/components/location-modal.tsx');
    const stores = source('src/screens/commerce-discovery-screen.tsx');

    expect(location).toContain('selectedPincode');
    expect(location).toContain('PIN_STORAGE_KEY');
    expect(location).toContain('serviceRegionError');
    expect(location).toContain('if (appConfig.allowDemoMode) return [DEFAULT_TIRUPATI_REGION]');
    expect(location).toContain("setSelectedPincode('')");
    expect(modal).toContain('Select Service Location');
    expect(modal).toContain('selectCity(city, pincode)');
    expect(modal).toContain('Retry loading service regions');
    expect(stores).toContain("capability: 'PRODUCT_STORE'");
    expect(stores).toContain('pincode: selectedPincode');
    expect(stores).toContain('Load more stores');
    expect(stores).toContain('refreshCities');
    expect(stores).not.toContain('fetchAllPublicOutlets');
    expect(stores).not.toContain('label="Approved"');
  });

  it('service-scopes direct product deep links with deterministic fallback navigation', () => {
    const productDetail = source('src/app/commerce/product-detail.tsx');
    const service = source('src/services/paginated-catalog.ts');

    expect(productDetail).toContain('fetchServiceableCommerceProduct(id, selectedPincode)');
    expect(productDetail).toContain('router.canGoBack()');
    expect(productDetail).toContain("router.replace('/products'");
    expect(productDetail).toContain('onBack={goBack}');
    expect(service).toContain('fetchServiceableCommerceProduct');
    expect(service).toContain('/api/v1/public/catalog/${encodeURIComponent(listingId)}?${params.toString()}');
  });

  it('requires backend service PIN filters for outlets, catalog pages and listing detail', () => {
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/application/web/PublicCatalogController.kt');

    expect(backend).toContain('normalizeOptionalPincode');
    expect(backend).toContain('@RequestParam(required = false) pincode: String?');
    expect(backend).toContain('(pincodeFilter == null || pincodeFilter in outlet.servicePinCodes)');
    expect(backend).toContain('(pincodeFilter == null || pincodeFilter in it.servicePinCodes)');
    expect(backend).toContain('(pincodeFilter != null && pincodeFilter !in outlet.servicePinCodes)');
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
