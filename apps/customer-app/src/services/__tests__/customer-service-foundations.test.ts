import type { Session } from '@supabase/supabase-js';

import { ApiError, apiClient } from '../api-client';
import { fetchBanners, fetchGuides, toggleGuideLike } from '../content';
import {
  createCustomerCase,
  fetchCustomerCases,
  getCustomerCaseEvidenceLink,
  uploadCustomerCaseEvidence,
} from '../customer-cases';
import { fetchProviders } from '../provider-discovery';
import { fetchProviderProfile } from '../provider-profile';
import { syncAuthenticatedProfile } from '@/utils/profile-sync';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test/',
    allowDemoMode: false,
  },
  requireMobileConfig: jest.fn(),
}));

const mockedFetch = jest.fn();

function response(input: {
  body?: unknown;
  text?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
} = {}): Response {
  const status = input.status ?? 200;
  const bodyText = input.text ?? (input.body === undefined ? '' : JSON.stringify(input.body));
  const headerValues = new Map(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: input.statusText ?? '',
    headers: { get: (name: string) => headerValues.get(name.toLowerCase()) ?? null },
    text: jest.fn().mockResolvedValue(bodyText),
    json: jest.fn().mockResolvedValue(input.body),
  } as unknown as Response;
}

const customerCase = {
  caseId: 'case-1',
  orderId: 'order-1',
  customerId: 'customer-1',
  caseType: 'DAMAGED_ITEM' as const,
  description: 'Packet was damaged',
  status: 'OPEN' as const,
  refundStatus: 'NOT_APPLICABLE' as const,
  evidence: [],
  createdAt: '2026-08-06T00:00:00Z',
  updatedAt: '2026-08-06T00:00:00Z',
};

describe('customer service foundations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
    apiClient.setSessionToken(null);
  });

  describe('api client', () => {
    it('joins relative URLs, adds bearer auth and serializes mutation bodies', async () => {
      apiClient.setSessionToken('session-token');
      mockedFetch.mockResolvedValueOnce(response({ body: { id: 'created' } }));

      await expect(
        apiClient.post('/api/v1/example', { name: 'Bruno' }, { 'X-Request-Id': 'request-1' }),
      ).resolves.toEqual({ id: 'created' });

      expect(mockedFetch).toHaveBeenCalledWith('https://api.mypet.test/api/v1/example', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session-token',
          'X-Request-Id': 'request-1',
        },
        body: JSON.stringify({ name: 'Bruno' }),
      });
    });

    it('preserves absolute URLs, raw string bodies and all convenience methods', async () => {
      mockedFetch
        .mockResolvedValueOnce(response({ text: 'accepted' }))
        .mockResolvedValueOnce(response({ body: { put: true } }))
        .mockResolvedValueOnce(response({ body: { patch: true } }))
        .mockResolvedValueOnce(response({ status: 204 }))
        .mockResolvedValueOnce(response({ body: { get: true } }));

      await expect(apiClient.post('https://uploads.mypet.test/file', 'raw-body')).resolves.toBe('accepted');
      await expect(apiClient.put('/resource/1', { value: 1 })).resolves.toEqual({ put: true });
      await expect(apiClient.patch('/resource/1', { value: 2 })).resolves.toEqual({ patch: true });
      await expect(apiClient.delete('/resource/1')).resolves.toEqual({});
      await expect(apiClient.get('/resource/1')).resolves.toEqual({ get: true });

      expect(mockedFetch.mock.calls[0][0]).toBe('https://uploads.mypet.test/file');
      expect(mockedFetch.mock.calls[0][1]?.body).toBe('raw-body');
      expect(mockedFetch.mock.calls[3][1]?.method).toBe('DELETE');
      expect(mockedFetch.mock.calls[4][1]).not.toHaveProperty('body');
    });

    it('returns empty objects for empty responses and structured ApiError metadata for failures', async () => {
      mockedFetch
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response({
          status: 429,
          statusText: 'Too Many Requests',
          body: { code: 'RATE_LIMITED', message: 'Retry later', fieldErrors: { phone: ['slow down'] } },
          headers: { 'retry-after': '3', 'x-request-id': 'trace-1' },
        }));

      await expect(apiClient.get('/empty')).resolves.toEqual({});

      const error = await apiClient.get('/limited').catch((value) => value as ApiError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 429,
        code: 'RATE_LIMITED',
        traceId: 'trace-1',
        retryAfterSeconds: 3,
        fieldErrors: { phone: ['slow down'] },
      });
    });
  });

  describe('content and provider reads', () => {
    it('loads authenticated banners and category-filtered guides', async () => {
      mockedFetch
        .mockResolvedValueOnce(response({ body: [{ id: 'banner-1' }] }))
        .mockResolvedValueOnce(response({ body: [{ id: 'guide-1', category: 'health' }] }))
        .mockResolvedValueOnce(response({ body: { liked: true, likeCount: 4 } }));

      await expect(fetchBanners('token')).resolves.toEqual([{ id: 'banner-1' }]);
      await expect(fetchGuides('health & care', 'token')).resolves.toEqual([
        { id: 'guide-1', category: 'health' },
      ]);
      await expect(toggleGuideLike('guide/1', 'token')).resolves.toEqual({ liked: true, likeCount: 4 });

      expect(mockedFetch.mock.calls[0][1]?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer token',
      });
      expect(mockedFetch.mock.calls[1][0]).toContain('?category=health%20%26%20care');
      expect(mockedFetch.mock.calls[2][1]).toMatchObject({ method: 'POST' });
    });

    it('maps discovery and provider profile numeric fields and encodes profile identifiers', async () => {
      mockedFetch
        .mockResolvedValueOnce(response({ body: [{
          providerId: 'provider-1',
          name: 'Happy Paws',
          description: '  Tirupati care  ',
          distanceKm: '2.4',
          ratingAvg: '4.7',
          ratingCount: 31,
        }] }))
        .mockResolvedValueOnce(response({ body: {
          providerId: 'provider/1',
          providerType: 'VET_HOSPITAL',
          fulfillmentType: 'APPOINTMENT',
          name: 'Happy Paws',
          description: null,
          city: 'Tirupati',
          ratingAvg: '4.8',
          ratingCount: 42,
          status: 'ACTIVE',
        } }));

      const providers = await fetchProviders('VET_HOSPITAL', {
        id: 'tirupati-ap',
        city: 'Tirupati',
        state: 'Andhra Pradesh',
        latitude: 13.6288,
        longitude: 79.4192,
        discoveryRadiusKm: 10,
      });
      expect(providers[0]).toEqual({
        id: 'provider-1',
        name: 'Happy Paws',
        description: 'Tirupati care',
        distanceKm: 2.4,
        rating: 4.7,
        ratingCount: 31,
      });
      expect(mockedFetch.mock.calls[0][0]).toContain('longitude=79.4192');
      expect(mockedFetch.mock.calls[0][0]).toContain('type=VET_HOSPITAL');

      await expect(fetchProviderProfile('provider/1')).resolves.toMatchObject({
        ratingAvg: 4.8,
        ratingCount: 42,
      });
      expect(mockedFetch.mock.calls[1][0]).toBe(
        'https://api.mypet.test//api/v1/providers/provider%2F1',
      );
    });

    it('surfaces deterministic content and provider status failures', async () => {
      mockedFetch
        .mockResolvedValueOnce(response({ status: 503 }))
        .mockResolvedValueOnce(response({ status: 404 }))
        .mockResolvedValueOnce(response({ status: 403 }));

      await expect(fetchBanners()).rejects.toThrow('Could not load banners');
      await expect(fetchProviders('PET_STORE', {
        id: 'tirupati-ap', city: 'Tirupati', state: 'Andhra Pradesh',
        latitude: 13.6288, longitude: 79.4192, discoveryRadiusKm: 10,
      })).rejects.toThrow('PROVIDER_DISCOVERY_404');
      await expect(fetchProviderProfile('provider-1')).rejects.toThrow('PROVIDER_PROFILE_403');
    });
  });

  describe('customer support evidence', () => {
    it('creates, lists, uploads and signs customer-case evidence with bearer ownership', async () => {
      const evidence = {
        evidenceId: 'evidence-1',
        originalFilename: 'damage.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        createdAt: '2026-08-06T00:00:00Z',
      };
      mockedFetch
        .mockResolvedValueOnce(response({ body: [customerCase] }))
        .mockResolvedValueOnce(response({ body: customerCase, status: 201 }))
        .mockResolvedValueOnce(response({ body: {
          uploadToken: 'upload-token',
          uploadUrl: 'https://uploads.mypet.test/case-evidence',
        } }))
        .mockResolvedValueOnce(response({ body: evidence, status: 201 }))
        .mockResolvedValueOnce(response({ body: { url: 'https://signed.mypet.test/evidence-1' } }));

      await expect(fetchCustomerCases('token')).resolves.toEqual([customerCase]);
      await createCustomerCase('order-1', 'DAMAGED_ITEM', 'Packet was damaged', 'token');
      await expect(uploadCustomerCaseEvidence(customerCase, {
        uri: 'file:///damage.jpg',
        name: 'damage.jpg',
        mimeType: 'image/jpeg',
      }, 'token')).resolves.toEqual(evidence);
      await expect(getCustomerCaseEvidenceLink('case/1', 'evidence/1', 'token')).resolves.toBe(
        'https://signed.mypet.test/evidence-1',
      );

      expect(JSON.parse(mockedFetch.mock.calls[1][1]?.body as string)).toEqual({
        orderId: 'order-1',
        caseType: 'DAMAGED_ITEM',
        description: 'Packet was damaged',
      });
      expect(mockedFetch.mock.calls[3][1]?.headers).toEqual({
        Authorization: 'Bearer token',
        Accept: 'application/json',
      });
      expect(mockedFetch.mock.calls[4][0]).toContain('/case/1/evidence/evidence/1/signed-link');
    });
  });

  describe('profile synchronization', () => {
    it('syncs the authenticated session with bearer token and fallback role', async () => {
      mockedFetch.mockResolvedValueOnce(response({ body: {
        userId: 'customer-1',
        role: 'CUSTOMER',
        fullName: 'Trinadh',
        phoneNumber: '9876543210',
      } }));
      const session = { access_token: 'access-token' } as Session;

      await expect(syncAuthenticatedProfile(session, 'CUSTOMER')).resolves.toMatchObject({
        userId: 'customer-1',
        role: 'CUSTOMER',
      });
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://api.mypet.test//api/v1/profiles/sync',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
            'X-User-Role': 'CUSTOMER',
          }),
        }),
      );
    });

    it('retains server status and response text when profile sync fails', async () => {
      mockedFetch.mockResolvedValueOnce(response({ status: 403, text: 'role mismatch' }));

      await expect(
        syncAuthenticatedProfile({ access_token: 'access-token' } as Session, 'CAPTAIN'),
      ).rejects.toThrow('Profile sync failed: 403 role mismatch');
    });
  });
});
