import {
  fetchProviderPage,
  fetchProviders,
  PROVIDER_DISCOVERY_PAGE_SIZE,
} from '../provider-discovery';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

const market = {
  id: 'tirupati-ap',
  city: 'Tirupati',
  state: 'Andhra Pradesh',
  latitude: 13.6288,
  longitude: 79.4192,
  discoveryRadiusKm: 10,
};

const mockedFetch = jest.fn();

function pageResponse(input: {
  capability: string;
  id?: string;
  page?: number;
  hasNext?: boolean;
  name?: string;
}): Response {
  const body = {
    items: [{
      id: input.id ?? 'provider-1',
      organizationId: 'org-1',
      name: input.name ?? 'Serviceable Paws',
      capabilities: [input.capability],
      pickupEnabled: input.capability === 'PRODUCT_STORE',
    }],
    page: input.page ?? 0,
    pageSize: PROVIDER_DISCOVERY_PAGE_SIZE,
    hasNext: input.hasNext ?? false,
  };
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('care provider serviceability', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('scopes grooming discovery to exactly the selected canonical PIN with bounded pages', async () => {
    mockedFetch.mockResolvedValueOnce(pageResponse({ capability: 'GROOMING' }));

    const page = await fetchProviderPage('GROOMER', market, '517501');

    expect(page.items).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/public/outlets?');
    expect(mockedFetch.mock.calls[0][0]).toContain('capability=GROOMING');
    expect(mockedFetch.mock.calls[0][0]).toContain('pincode=517501');
    expect(mockedFetch.mock.calls[0][0]).toContain(`pageSize=${PROVIDER_DISCOVERY_PAGE_SIZE}`);
  });

  it('fails closed before the network when the selected live PIN is missing or invalid', async () => {
    await expect(fetchProviderPage('GROOMER', market, undefined)).rejects.toThrow('six-digit service PIN');
    await expect(fetchProviderPage('PET_STORE', market, '017501')).rejects.toThrow('six-digit service PIN');
    await expect(fetchProviderPage('VET_HOSPITAL', market, 'invalid')).rejects.toThrow('six-digit service PIN');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('checks both veterinary capabilities for one selected PIN and deduplicates the same outlet', async () => {
    mockedFetch.mockImplementation((url: string) => {
      const capability = url.includes('VETERINARY_HOSPITAL')
        ? 'VETERINARY_HOSPITAL'
        : 'VETERINARY_CLINIC';
      return Promise.resolve(pageResponse({ capability, id: 'same-provider' }));
    });

    const providers = await fetchProviderPage('VET_HOSPITAL', market, '517507');

    expect(providers.items).toHaveLength(1);
    expect(providers.items[0]).toMatchObject({
      id: 'same-provider',
      name: 'Serviceable Paws',
    });
    expect(providers.items[0]).not.toHaveProperty('rating');
    expect(providers.items[0]).not.toHaveProperty('distanceKm');
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const urls = mockedFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('capability=VETERINARY_CLINIC') && url.includes('pincode=517507'))).toBe(true);
    expect(urls.some((url) => url.includes('capability=VETERINARY_HOSPITAL') && url.includes('pincode=517507'))).toBe(true);
  });

  it('walks real next pages and deduplicates an overlapping provider across pages', async () => {
    mockedFetch
      .mockResolvedValueOnce(pageResponse({ capability: 'GROOMING', id: 'provider-1', page: 0, hasNext: true, name: 'Alpha Groomer' }))
      .mockResolvedValueOnce(pageResponse({ capability: 'GROOMING', id: 'provider-1', page: 1, hasNext: false, name: 'Alpha Groomer' }));

    const providers = await fetchProviders('GROOMER', market, '517501');

    expect(providers).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[0][0]).toContain('page=0');
    expect(mockedFetch.mock.calls[1][0]).toContain('page=1');
  });
});
