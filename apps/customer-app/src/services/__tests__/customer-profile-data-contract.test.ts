import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkOutletServiceability,
  createCustomerAddress,
  deleteCustomerAddress,
  fetchCustomerAddresses,
  fetchCustomerProfile,
  updateCustomerAddress,
  updateCustomerProfile,
} from '@/services/customer-profile';
import {
  createCustomerPet,
  deleteCustomerPet,
  fetchCustomerPetPage,
  updateCustomerPet,
} from '@/services/customer-pets';

jest.mock('@/utils/app-config', () => ({
  appConfig: { apiBaseUrl: 'https://api.mypet.test', allowDemoMode: false },
}));

const mockedFetch = jest.fn();

function response(body: unknown = {}, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: jest.fn().mockReturnValue(null) },
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockedFetch.mockReset();
  global.fetch = mockedFetch as unknown as typeof fetch;
});

describe('P2 canonical customer-owned data client contracts', () => {
  it('uses customer-owned profile pets and addresses without client customer ids', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ accountId: 'a', name: 'A', mobile: '+919812345678', email: null, profileCompletion: 100 }))
      .mockResolvedValueOnce(response({ accountId: 'a', name: 'B', mobile: '+919812345678', email: null, profileCompletion: 100 }))
      .mockResolvedValueOnce(response({ items: [], page: 0, pageSize: 20, hasNext: false }))
      .mockResolvedValueOnce(response({ petId: 'pet-1', name: 'Bruno', species: 'DOG' }, 201))
      .mockResolvedValueOnce(response({ petId: 'pet-1', name: 'Bruno 2', species: 'DOG' }))
      .mockResolvedValueOnce(response({}, 204))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({
        addressId: 'address-1', label: 'Home', recipientName: 'A', phoneNumber: '+919812345678',
        line1: 'Main Road', line2: null, city: 'Tirupati', state: 'Andhra Pradesh', pincode: '517501',
        isDefault: true, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z',
      }, 201))
      .mockResolvedValueOnce(response({
        addressId: 'address-1', label: 'Home 2', recipientName: 'A', phoneNumber: '+919812345678',
        line1: 'Main Road', line2: null, city: 'Tirupati', state: 'Andhra Pradesh', pincode: '517501',
        isDefault: true, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:01Z',
      }))
      .mockResolvedValueOnce(response({}, 204));

    await fetchCustomerProfile('token');
    await updateCustomerProfile('token', { name: 'B' });
    await fetchCustomerPetPage('token');
    await createCustomerPet({ name: 'Bruno', species: 'DOG' }, 'token');
    await updateCustomerPet('pet-1', { name: 'Bruno 2', species: 'DOG' }, 'token');
    await deleteCustomerPet('pet-1', 'token');
    await fetchCustomerAddresses('token');
    await createCustomerAddress('token', {
      label: 'Home', recipientName: 'A', phoneNumber: '9812345678', line1: 'Main Road',
      city: 'Tirupati', state: 'Andhra Pradesh', pincode: '517501', isDefault: true,
    });
    await updateCustomerAddress('token', 'address-1', {
      label: 'Home 2', recipientName: 'A', phoneNumber: '+919812345678', line1: 'Main Road',
      city: 'Tirupati', state: 'Andhra Pradesh', pincode: '517501', isDefault: true,
    });
    await deleteCustomerAddress('token', 'address-1');

    const urls = mockedFetch.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(expect.arrayContaining([
      'https://api.mypet.test/api/v1/customer/profile',
      'https://api.mypet.test/api/v1/customer/pets?page=0&pageSize=20',
      'https://api.mypet.test/api/v1/customer/pets',
      'https://api.mypet.test/api/v1/customer/addresses',
    ]));
    expect(urls.join('\n')).not.toContain('customerId=');
    expect(urls.join('\n')).not.toContain('/api/v1/pets');
    expect(urls.join('\n')).not.toContain('/api/v1/addresses/default');
  });

  it('uses public PIN serviceability and never sends precise coordinates from the active profile flow', async () => {
    mockedFetch.mockResolvedValueOnce(response({ serviceable: true, fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY', reasonCode: 'SERVICEABLE' }));
    await expect(checkOutletServiceability('outlet-1', '517501')).resolves.toMatchObject({ serviceable: true });
    expect(mockedFetch.mock.calls[0][0]).toContain('/api/v1/public/outlets/outlet-1/serviceability?pincode=517501&mode=DELIVERY');

    const source = readFileSync(join(process.cwd(), 'src/screens/profile-screen.tsx'), 'utf8');
    expect(source).toContain('fetchCustomerProfile');
    expect(source).toContain('fetchCustomerPets');
    expect(source).toContain('createCustomerPet');
    expect(source).toContain('fetchCustomerAddresses');
    expect(source).not.toContain('geoLat');
    expect(source).not.toContain('geoLng');
    expect(source).not.toContain("'/api/v1/pets'");
    expect(source).not.toContain("'/api/v1/addresses/default'");
  });
});
