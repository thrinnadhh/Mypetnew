import { fetchProviders } from '../provider-discovery';

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

function pageResponse(capability: string): Response {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      items: [{
        id: 'provider-1',
        organizationId: 'org-1',
        name: 'Serviceable Paws',
        capabilities: [capability],
        pickupEnabled: false,
      }],
      page: 0,
      pageSize: 100,
      hasNext: false,
    }),
  } as unknown as Response;
}

describe('care provider serviceability', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('deduplicates PIN codes and scopes grooming discovery to the canonical outlet filter', async () => {
    mockedFetch.mockResolvedValueOnce(pageResponse('GROOMING'));

    const providers = await fetchProviders(
      'GROOMER',
      market,
      ['517501', '517501', 'invalid', '017501'],
    );

    expect(providers).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/public/outlets?');
    expect(mockedFetch.mock.calls[0][0]).toContain('capability=GROOMING');
    expect(mockedFetch.mock.calls[0][0]).toContain('pincode=517501');
    expect(mockedFetch.mock.calls[0][0]).not.toContain('invalid');
  });

  it('checks both veterinary capabilities across every selected service PIN and deduplicates outlets', async () => {
    mockedFetch.mockImplementation((url: string) => {
      const capability = url.includes('VETERINARY_HOSPITAL')
        ? 'VETERINARY_HOSPITAL'
        : 'VETERINARY_CLINIC';
      return Promise.resolve(pageResponse(capability));
    });

    const providers = await fetchProviders(
      'VET_HOSPITAL',
      market,
      ['517501', '517507'],
    );

    expect(providers).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(4);
    const urls = mockedFetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('capability=VETERINARY_CLINIC') && url.includes('pincode=517501'))).toBe(true);
    expect(urls.some((url) => url.includes('capability=VETERINARY_CLINIC') && url.includes('pincode=517507'))).toBe(true);
    expect(urls.some((url) => url.includes('capability=VETERINARY_HOSPITAL') && url.includes('pincode=517501'))).toBe(true);
    expect(urls.some((url) => url.includes('capability=VETERINARY_HOSPITAL') && url.includes('pincode=517507'))).toBe(true);
  });
});
