import { apiClient } from '@/services/api-client';
import {
  fetchCatalogPage,
  fetchCommerceProducts,
  fetchPublicOutlets,
} from '@/services/customer-catalog';

jest.mock('@/services/api-client', () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

jest.mock('@/utils/app-config', () => ({
  appConfig: { apiBaseUrl: 'https://api.mypet.test', allowDemoMode: false },
}));

const getMock = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ items: [], page: 0, pageSize: 50, hasNext: false });
});

describe('P3 canonical discovery filter client contract', () => {
  it('sends explicit service PIN and existing outlet filters through the canonical public endpoint', async () => {
    await fetchPublicOutlets({
      page: 0,
      pageSize: 20,
      capability: 'PRODUCT_STORE',
      pincode: '517501',
      q: 'happy pets',
    });

    expect(getMock).toHaveBeenCalledTimes(1);
    const url = String(getMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/public/outlets?');
    expect(url).toContain('capability=PRODUCT_STORE');
    expect(url).toContain('pincode=517501');
    expect(url).toContain('q=happy+pets');
  });

  it('sends commerceMode with the canonical catalog query instead of filtering medicine client-side', async () => {
    await fetchCatalogPage({
      outletId: 'outlet-1',
      commerceMode: 'VIEW_ONLY',
      sort: 'NEWEST',
    });

    expect(getMock).toHaveBeenCalledTimes(1);
    const url = String(getMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/public/catalog?');
    expect(url).toContain('outletId=outlet-1');
    expect(url).toContain('commerceMode=VIEW_ONLY');
    expect(url).toContain('sort=NEWEST');
  });

  it('forces commerce discovery to request COMMERCE listings so VIEW_ONLY medicine is not treated as purchasable inventory', async () => {
    await fetchCommerceProducts({ q: 'dog food' });

    expect(getMock).toHaveBeenCalledTimes(1);
    const url = String(getMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/public/catalog?');
    expect(url).toContain('q=dog+food');
    expect(url).toContain('commerceMode=COMMERCE');
  });
});
