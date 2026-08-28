import type { OfflineCommandRecord } from '../../data/models/outbox-types';
import { SyncTransport } from '../sync-transport';

describe('M6 SyncTransport', () => {
  const baseCommand: OfflineCommandRecord = {
    commandId: 'cmd_1',
    accountId: 'acc_1',
    organizationId: 'org_1',
    outletId: 'out_1',
    installationId: 'inst_1',
    idempotencyKey: 'idem_1',
    commandType: 'INVENTORY_ADJUSTMENT',
    payloadSchemaVersion: 1,
    payloadJson: JSON.stringify({
      outletId: 'out_1',
      listingId: 'list_1',
      quantityDelta: 5,
      reason: 'MANUAL_INCREASE',
    }),
    requestFingerprint: 'fp_1',
    state: 'SENDING',
    attemptCount: 1,
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
    lastAttemptAt: '2026-08-28T12:00:00.000Z',
    nextAttemptAt: null,
    leaseOwner: 'worker_1',
    leaseExpiresAt: '2026-08-28T12:00:30.000Z',
    lastErrorCode: null,
    lastErrorDetails: null,
    durableServerReceipt: null,
    resultingVersion: null,
  };

  it('dispatches INVENTORY_ADJUSTMENT command correctly and extracts server receipt', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    const mockFetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? '';
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = (init?.body as string) ?? '';

      return new Response(
        JSON.stringify({
          id: 'mov_1',
          resultingOnHand: 15,
          resultingReserved: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(baseCommand);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(capturedUrl).toBe('/api/v1/merchant/inventory/adjustments');
      expect(capturedMethod).toBe('POST');
      expect(capturedHeaders['Idempotency-Key']).toBe('idem_1');
      expect(JSON.parse(capturedBody).quantityDelta).toBe(5);
      expect(result.receipt.resultingOnHand).toBe(15);
      expect(result.receipt.receiptId).toBe('mov_1');
    }
  });

  it('dispatches CATALOG_UPDATE and lifecycle commands to their respective endpoints', async () => {
    const updateCommand: OfflineCommandRecord = {
      ...baseCommand,
      commandType: 'CATALOG_UPDATE',
      payloadJson: JSON.stringify({
        outletId: 'out_1',
        listingId: 'list_123',
        expectedVersion: 2,
        name: 'Updated Name',
        mrpPaise: 500,
        sellingPricePaise: 450,
        category: 'food',
      }),
    };

    let capturedUrl = '';
    let capturedMethod = '';

    const mockFetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? '';
      return new Response(
        JSON.stringify({
          id: 'list_123',
          version: 3,
          name: 'Updated Name',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(updateCommand);

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe('/api/v1/merchant/listings/list_123');
    expect(capturedMethod).toBe('PATCH');
    if (result.ok) {
      expect(result.receipt.resultingVersion).toBe(3);
    }
  });

  it('handles server errors and Retry-After header cleanly', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          code: 'RATE_LIMITED',
          message: 'Too many requests; slow down',
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
          },
        },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(baseCommand);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.retryAfter).toBe('30');
      expect(result.error.message).toBe('Too many requests; slow down');
      expect(result.error.name).toBe('RATE_LIMITED');
    }
  });

  it('handles network failure gracefully without throwing unhandled exceptions', async () => {
    const mockFetch = async () => {
      throw new Error('Connection refused');
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(baseCommand);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Connection refused');
    }
  });

  it('rejects dispatch without making network calls when payloadSchemaVersion is unsupported', async () => {
    let networkCalled = false;
    const mockFetch = async () => {
      networkCalled = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const invalidCommand: OfflineCommandRecord = {
      ...baseCommand,
      payloadSchemaVersion: 99, // Unsupported
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(invalidCommand);

    expect(networkCalled).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error.name).toBe('COMMAND_SCHEMA_UNSUPPORTED');
    }
  });

  it('fetches server receipt by idempotency key', async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain('/api/v1/merchant/sync/receipts/idem_1?outletId=out_1');
      return new Response(
        JSON.stringify({
          idempotencyKey: 'idem_1',
          commandType: 'INVENTORY_ADJUSTMENT',
          entityType: 'INVENTORY_BALANCE',
          entityId: 'list_1',
          resultingOnHand: 20,
          movementId: 'mov_123',
          status: 'ACCEPTED',
          createdAt: '2026-08-28T12:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const receipt = await transport.fetchReceipt('out_1', 'idem_1');

    expect(receipt).not.toBeNull();
    expect(receipt?.receiptId).toBe('mov_123');
    expect(receipt?.resultingOnHand).toBe(20);
  });
});
