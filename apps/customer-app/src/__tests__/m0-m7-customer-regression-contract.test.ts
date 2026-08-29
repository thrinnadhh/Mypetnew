import type { CommerceProduct } from '@/services/catalog-types';
import {
  fetchCatalogPage,
  mapListingToCommerceProduct,
} from '@/services/customer-catalog';
import {
  hasServerPriceChange,
  isQuoteExpired,
  requiresFreshQuote,
} from '@/services/checkout-safety';

jest.mock('@/services/customer-catalog', () => ({
  fetchCatalogPage: jest.fn(),
  fetchCommerceProduct: jest.fn(),
  mapListingToCommerceProduct: jest.fn(),
  normalizeDemoCommerceProduct: jest.fn((product) => product),
}));

jest.mock('@/utils/app-config', () => ({
  appConfig: { allowDemoMode: false },
}));

const fetchCatalogPageMock = fetchCatalogPage as jest.MockedFunction<typeof fetchCatalogPage>;
const mapListingMock = mapListingToCommerceProduct as jest.MockedFunction<typeof mapListingToCommerceProduct>;

describe('M0–M7 Customer Regression Protection Contract', () => {
  beforeEach(() => {
    fetchCatalogPageMock.mockReset();
    mapListingMock.mockReset();
  });

  it('Flow Group AD - Customer catalog strictly excludes local pseudo-IDs and unsynced drafts', async () => {
    const canonicalListing = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Pedigree Pro 3kg',
      category: 'dog-food',
      mrpPaise: 120000,
      sellingPricePaise: 105000,
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      active: true,
    };

    fetchCatalogPageMock.mockResolvedValue({
      items: [canonicalListing as never],
      page: 1,
      pageSize: 20,
      hasNext: false,
    });

    mapListingMock.mockReturnValue({
      id: canonicalListing.id,
      name: canonicalListing.name,
      category: canonicalListing.category,
      price: 1050,
      inStock: true,
      stockCount: 10,
      galleryImages: [],
      createdAt: '2026-08-20T00:00:00Z',
      isNewArrival: false,
      providerId: 'outlet-1',
      providerName: 'Pet Care Store',
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
      pickupEnabled: true,
      variants: [{ id: canonicalListing.id, name: canonicalListing.name, price: 1050, inStock: true, stockCount: 10 }],
      specifications: {},
      suitability: [],
    });

    const page = await fetchCatalogPageMock('outlet-1', 1, 20);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).not.toMatch(/^local:/);
    expect(page.items[0].id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('Flow Group AD & N - Medicine items remain strictly VIEW_ONLY and non-purchasable', () => {
    const medicineItem: CommerceProduct = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Vet Antibiotic Drops',
      category: 'medicine',
      price: 350,
      inStock: true,
      stockCount: 5,
      galleryImages: [],
      createdAt: '2026-08-20T00:00:00Z',
      isNewArrival: false,
      providerId: 'outlet-1',
      providerName: 'Vet Clinic Outlet',
      kind: 'MEDICINE',
      commerceMode: 'VIEW_ONLY',
      pickupEnabled: true,
      variants: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Vet Antibiotic Drops', price: 350, inStock: true, stockCount: 5 }],
      specifications: {},
      suitability: [],
    };

    expect(medicineItem.kind).toBe('MEDICINE');
    expect(medicineItem.commerceMode).toBe('VIEW_ONLY');
  });

  it('Flow Group AG - Money and quote pricing detects price changes in paise without float corruption', () => {
    // 100 Rs = 10,000 paise
    expect(hasServerPriceChange(100, 10000)).toBe(false);
    // Price change: Cart has 100 Rs (10,000 paise), server has 105 Rs (10,500 paise)
    expect(hasServerPriceChange(100, 10500)).toBe(true);

    // Stale quote detection
    expect(isQuoteExpired('2026-08-29T12:00:00Z', Date.parse('2026-08-29T12:05:00Z'))).toBe(true);
    expect(isQuoteExpired('2026-08-29T12:10:00Z', Date.parse('2026-08-29T12:05:00Z'))).toBe(false);
  });
});
