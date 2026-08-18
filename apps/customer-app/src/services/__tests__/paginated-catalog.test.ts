import type { CommerceProduct } from '@/services/catalog-data';
import {
  fetchCatalogPage,
  mapListingToCommerceProduct,
} from '@/services/customer-catalog';
import {
  CUSTOMER_CATALOG_PAGE_SIZE,
  fetchCommerceCatalogPage,
  fetchProductCatalogPage,
  mergeUniqueProducts,
} from '@/services/paginated-catalog';

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

const product = (id: string, name = id): CommerceProduct => ({
  id,
  name,
  category: 'food',
  price: 499,
  inStock: true,
  stockCount: 5,
  galleryImages: [],
  createdAt: '2026-08-01T00:00:00Z',
  isNewArrival: false,
  providerId: 'outlet-1',
  providerName: 'Store',
  kind: 'PRODUCT',
  commerceMode: 'COMMERCE',
  pickupEnabled: true,
  variants: [{ id, name, price: 499, inStock: true, stockCount: 5 }],
  specifications: {},
  suitability: [],
});

describe('P4 bounded catalog pagination', () => {
  beforeEach(() => {
    fetchCatalogPageMock.mockReset();
    mapListingMock.mockReset();
  });

  it('fetches exactly one requested catalog page and maps only that page', async () => {
    const listing = { id: 'listing-1' } as never;
    fetchCatalogPageMock.mockResolvedValue({
      items: [listing],
      page: 2,
      pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      hasNext: true,
    });
    mapListingMock.mockReturnValue(product('listing-1'));

    const response = await fetchCommerceCatalogPage({
      q: 'dog food',
      page: 2,
      pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      availability: 'IN_STOCK',
      sort: 'PRICE_ASC',
    });

    expect(fetchCatalogPageMock).toHaveBeenCalledTimes(1);
    expect(fetchCatalogPageMock).toHaveBeenCalledWith(expect.objectContaining({
      q: 'dog food',
      page: 2,
      pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      availability: 'IN_STOCK',
      sort: 'PRICE_ASC',
    }));
    expect(response).toMatchObject({ page: 2, hasNext: true });
    expect(response.items.map((item) => item.id)).toEqual(['listing-1']);
  });

  it('forces product discovery to the PRODUCT + COMMERCE backend contract', async () => {
    fetchCatalogPageMock.mockResolvedValue({
      items: [],
      page: 0,
      pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      hasNext: false,
    });

    await fetchProductCatalogPage({ q: 'toy', page: 0 });

    expect(fetchCatalogPageMock).toHaveBeenCalledTimes(1);
    expect(fetchCatalogPageMock).toHaveBeenCalledWith(expect.objectContaining({
      q: 'toy',
      page: 0,
      kind: 'PRODUCT',
      commerceMode: 'COMMERCE',
    }));
  });

  it('propagates a page failure so the caller can retry the same page, then succeeds on retry', async () => {
    const listing = { id: 'listing-retry' } as never;
    fetchCatalogPageMock
      .mockRejectedValueOnce(new Error('temporary catalogue failure'))
      .mockResolvedValueOnce({
        items: [listing],
        page: 1,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
        hasNext: false,
      });
    mapListingMock.mockReturnValue(product('listing-retry'));

    await expect(fetchCommerceCatalogPage({ page: 1 })).rejects.toThrow('temporary catalogue failure');
    const retry = await fetchCommerceCatalogPage({ page: 1 });

    expect(fetchCatalogPageMock).toHaveBeenCalledTimes(2);
    expect(fetchCatalogPageMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1 }));
    expect(fetchCatalogPageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 1 }));
    expect(retry).toMatchObject({ page: 1, hasNext: false });
    expect(retry.items.map((item) => item.id)).toEqual(['listing-retry']);
  });

  it('keeps first-page and next-page requests independent so reset starts again at page zero', async () => {
    fetchCatalogPageMock.mockResolvedValue({
      items: [],
      page: 0,
      pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      hasNext: false,
    });

    await fetchCommerceCatalogPage({ q: 'food', page: 0 });
    await fetchCommerceCatalogPage({ q: 'food', page: 1 });
    await fetchCommerceCatalogPage({ q: 'toys', page: 0 });

    expect(fetchCatalogPageMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ q: 'food', page: 0 }));
    expect(fetchCatalogPageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ q: 'food', page: 1 }));
    expect(fetchCatalogPageMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ q: 'toys', page: 0 }));
  });

  it('appends pages without duplicating canonical listing IDs', () => {
    expect(
      mergeUniqueProducts(
        [product('one'), product('two', 'old')],
        [product('two', 'new'), product('three')],
      ).map(({ id, name }) => ({ id, name })),
    ).toEqual([
      { id: 'one', name: 'one' },
      { id: 'two', name: 'new' },
      { id: 'three', name: 'three' },
    ]);
  });
});
