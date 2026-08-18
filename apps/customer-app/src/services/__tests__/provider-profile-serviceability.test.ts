import { fetchProviderProfile } from '../provider-profile';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

const mockedFetch = jest.fn();
const providerId = '11111111-1111-4111-8111-111111111111';

function response(capabilities: string[], status = 200): Response {
  const body = status >= 200 && status < 300
    ? {
        id: providerId,
        organizationId: 'org-1',
        name: 'Live Paws',
        capabilities,
        pickupEnabled: false,
      }
    : { code: 'NOT_FOUND', message: 'Provider unavailable' };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : '',
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('provider profile serviceability', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('asks the public detail endpoint to validate grooming capability and selected PIN', async () => {
    mockedFetch.mockResolvedValueOnce(response(['GROOMING']));

    await expect(fetchProviderProfile(providerId, {
      kind: 'groomer',
      pincode: '517501',
    })).resolves.toMatchObject({
      providerId,
      providerType: 'GROOMER',
      capabilities: ['GROOMING'],
    });

    const url = String(mockedFetch.mock.calls[0][0]);
    expect(url).toContain(`/api/v1/public/outlets/${providerId}?`);
    expect(url).toContain('pincode=517501');
    expect(url).toContain('capability=GROOMING');
  });

  it('lets the backend validate both veterinary capabilities until one exact capability succeeds', async () => {
    mockedFetch
      .mockResolvedValueOnce(response([], 404))
      .mockResolvedValueOnce(response(['VETERINARY_HOSPITAL']));

    await expect(fetchProviderProfile(providerId, {
      kind: 'vet',
      pincode: '517507',
    })).resolves.toMatchObject({
      providerType: 'VET_HOSPITAL',
      capabilities: ['VETERINARY_HOSPITAL'],
    });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const firstUrl = String(mockedFetch.mock.calls[0][0]);
    const secondUrl = String(mockedFetch.mock.calls[1][0]);
    expect(firstUrl).toContain('pincode=517507');
    expect(firstUrl).toContain('capability=VETERINARY_CLINIC');
    expect(secondUrl).toContain('pincode=517507');
    expect(secondUrl).toContain('capability=VETERINARY_HOSPITAL');
  });

  it('rejects a wrong-capability provider even if a malformed public response itself succeeds', async () => {
    mockedFetch.mockResolvedValueOnce(response(['PRODUCT_STORE']));

    await expect(fetchProviderProfile(providerId, {
      kind: 'vet',
      pincode: '517501',
    })).rejects.toThrow('PROVIDER_CAPABILITY_MISMATCH');
  });

  it('fails closed before the network for an invalid service PIN', async () => {
    await expect(fetchProviderProfile(providerId, {
      kind: 'groomer',
      pincode: '',
    })).rejects.toThrow('six-digit service PIN');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('does not claim serviceability for legacy non-UUID provider identifiers', async () => {
    await expect(fetchProviderProfile('legacy-provider', {
      kind: 'groomer',
      pincode: '517501',
    })).rejects.toThrow('PROVIDER_SERVICEABILITY_UNVERIFIABLE');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
