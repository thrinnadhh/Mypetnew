import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ApiError } from '../../contracts/api-error';
import { apiClient } from '../api-client';
import { fetchCustomerLoyaltyBalance } from '../loyalty';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('T1 API Convention Normalization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    apiClient.setSessionToken(null);
  });

  it('normalizes X-Idempotency-Key to canonical Idempotency-Key in ApiClient headers', async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation((_url, init) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    });

    apiClient.setSessionToken('test-token-123');
    await apiClient.post('/api/v1/test', { data: 1 }, { 'X-Idempotency-Key': 'key-abc-123' });

    expect(capturedHeaders.Accept).toBe('application/json');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders.Authorization).toBe('Bearer test-token-123');
    expect(capturedHeaders['Idempotency-Key']).toBe('key-abc-123');
  });

  it('formats fetchCustomerLoyaltyBalance to canonical /api/v1/customer/loyalty/{organizationId} endpoint', async () => {
    let requestedUrl = '';
    let authHeader = '';

    global.fetch = jest.fn().mockImplementation((url, init) => {
      requestedUrl = String(url);
      authHeader = (init?.headers as Record<string, string>)?.Authorization || '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            organizationId: 'org-uuid-123',
            availableStars: 10,
            rewards: 2,
          }),
          { status: 200 },
        ),
      );
    });

    const result = await fetchCustomerLoyaltyBalance('org-uuid-123', 'session-xyz');
    expect(requestedUrl).toContain('/api/v1/customer/loyalty/org-uuid-123');
    expect(authHeader).toBe('Bearer session-xyz');
    expect(result.availableStars).toBe(10);
    expect(result.rewards).toBe(2);
  });

  it('preserves status, code, traceId, and fieldErrors on fetchCustomerLoyaltyBalance ApiError failure', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'RESOURCE_NOT_FOUND',
            message: 'The requested resource is unavailable',
            traceId: 'trace-abc-789',
            fieldErrors: { organizationId: 'invalid' },
          }),
          {
            status: 404,
            statusText: 'Not Found',
            headers: { 'x-trace-id': 'trace-abc-789' },
          },
        ),
      ),
    );

    let thrown: unknown;
    try {
      await fetchCustomerLoyaltyBalance('org-invalid', 'token-123');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const apiErr = thrown as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe('RESOURCE_NOT_FOUND');
    expect(apiErr.traceId).toBe('trace-abc-789');
    expect(apiErr.message).toBe('The requested resource is unavailable');
    expect(apiErr.fieldErrors).toEqual({ organizationId: ['invalid'] });
  });

  it('verifies IdentityController contract and classifies direct Supabase Auth in customer app as mismatch', () => {
    const identityBackend = source(
      '../../backend/src/main/kotlin/in/mypetnew/application/web/IdentityController.kt',
    );
    const otpAuthClient = source('src/auth/otp-auth.ts');
    const authContextClient = source('src/context/AuthContext.tsx');
    const matrixDoc = source('../../docs/architecture/CUSTOMER_API_COMPATIBILITY_MATRIX.md');

    expect(identityBackend).toContain('@PostMapping("/otp/request")');
    expect(identityBackend).toContain('@PostMapping("/otp/verify")');
    expect(identityBackend).toContain('@PostMapping("/sessions/refresh")');
    expect(identityBackend).toContain('@DeleteMapping("/sessions/current")');

    expect(otpAuthClient).toContain('/api/v1/auth/otp/request');
    expect(otpAuthClient).toContain('/api/v1/auth/otp/verify');
    expect(authContextClient).toContain('apiClient');

    expect(matrixDoc).toContain('Customer Authentication');
    expect(matrixDoc).toContain('MISMATCH');
  });

  it('verifies catalog legacy paths and classifies customer catalog as mismatch against GET /api/v1/public/catalog', () => {
    const publicCatalogBackend = source(
      '../../backend/src/main/kotlin/in/mypetnew/application/web/PublicCatalogController.kt',
    );
    const customerCatalogClient = source('src/services/customer-catalog.ts');
    const providerDiscoveryClient = source('src/services/provider-discovery.ts');
    const matrixDoc = source('../../docs/architecture/CUSTOMER_API_COMPATIBILITY_MATRIX.md');

    expect(publicCatalogBackend).toContain('@RequestMapping("/api/v1/public/catalog")');
    expect(publicCatalogBackend).toContain('PublicListingSummary');

    expect(customerCatalogClient).toContain('/api/v1/catalog/offerings');
    expect(customerCatalogClient).toContain('/api/v1/providers');
    expect(providerDiscoveryClient).toContain('/api/v1/discovery/providers');

    expect(matrixDoc).toContain('/api/v1/discovery/providers');
    expect(matrixDoc).toContain('/api/v1/public/catalog');
    expect(matrixDoc).toContain('MISMATCH');
  });

  it('verifies exact ProductOrder backend DTO fields and validates absence of invented fields', () => {
    const orderServiceBackend = source(
      '../../backend/src/main/kotlin/in/mypetnew/commerce/domain/OrderService.kt',
    );

    expect(orderServiceBackend).toContain('data class ProductOrder(');
    expect(orderServiceBackend).toContain('val id: UUID');
    expect(orderServiceBackend).toContain('val customerId: UUID');
    expect(orderServiceBackend).toContain('val outletId: UUID');
    expect(orderServiceBackend).toContain('val lines: Map<UUID, Int>');
    expect(orderServiceBackend).toContain('val grandTotalPaise: Long');
    expect(orderServiceBackend).toContain('val platformFeePaise: Long');
    expect(orderServiceBackend).toContain('val merchantCommissionPaise: Long');
    expect(orderServiceBackend).toContain('val paymentMethod: String');
    expect(orderServiceBackend).toContain('val status: OrderStatus');
    expect(orderServiceBackend).toContain('val history: List<OrderHistoryEntry>');

    expect(orderServiceBackend).not.toContain('val totalAmountPaise');
    expect(orderServiceBackend).not.toContain('val placedAt: Instant');
  });
});
