import { fetchProviderProfile } from '../provider-profile';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

const mockedFetch = jest.fn();
const providerId = '11111111-1111-4111-8111-111111111111';

function response(capabilities: string[]): Response {
  const body = {
    id: providerId,
    organizationId: 'org-1',
    name: 'Live Paws',
    capabilities,
    pickupEnabled: false,
  };
  return {
    ok: true,
    status: 200,
    statusText: '',
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

  it('validates veterinary OR capability after the PIN-scoped public read', async () => {
    mockedFetch.mockResolvedValueOnce(response(['VETERINARY_HOSPITAL']));

    await expect(fetchProviderProfile(providerId, {
      kind: 'vet',
      pincode: '517507',
    })).resolves.toMatchObject({
      providerType: 'VET_HOSPITAL',
      capabilities: ['VETERINARY_HOSPITAL'],
    });

    const url = String(mockedFetch.mock.calls[0][0]);
    expect(url).toContain('pincode=517507');
    expect(url).not.toContain('capability=');
  });

  it('rejects a wrong-capability provider even if the public detail itself succeeds', async () => {
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
});
