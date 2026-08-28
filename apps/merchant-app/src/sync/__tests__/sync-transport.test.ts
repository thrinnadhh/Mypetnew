import type { OfflineCommandRecord } from '../../data/models/outbox-types';
import { SyncTransport } from '../sync-transport';

describe('SyncTransport', () => {
  const baseCommand: OfflineCommandRecord = {
    commandId: 'cmd_1',
    accountId: 'acc_1',
    organizationId: 'org_1',
    outletId: 'out_1',
    installationId: 'inst_1',
    idempotencyKey: 'idemp_key_1',
    commandType: 'INVENTORY_ADJUSTMENT',
    payloadSchemaVersion: 1,
    payloadJson: JSON.stringify({
      outletId: 'out_1',
      listingId: 'item_1',
      quantityDelta: 10,
      reason: 'MANUAL_INCREASE',
    }),
    requestFingerprint: 'fp_1',
    state: 'PENDING',
    attemptCount: 0,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    lastAttemptAt: null,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorDetails: null,
    durableServerReceipt: null,
    resultingVersion: null,
  };

  it('dispatches inventory adjustment successfully with server headers', async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch = async (_url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(
        JSON.stringify({
          id: 'movement_1',
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
      expect(result.status).toBe(200);
      expect(result.receipt.receiptId).toBe('movement_1');
      expect(result.receipt.resultingOnHand).toBe(15);
    }
    expect(capturedHeaders['X-MyPet-Command-Type']).toBe('INVENTORY_ADJUSTMENT');
    expect(capturedHeaders['X-MyPet-Payload-Schema-Version']).toBe('1');
    expect(capturedHeaders['Idempotency-Key']).toBe('idemp_key_1');
  });

  it('dispatches catalog update with patch method and version receipt', async () => {
    const cmd: OfflineCommandRecord = {
      ...baseCommand,
      commandType: 'CATALOG_UPDATE',
      payloadJson: JSON.stringify({
        outletId: 'out_1',
        listingId: 'item_1',
        expectedVersion: 2,
        name: 'Updated Name',
        mrpPaise: 500,
        sellingPricePaise: 400,
        category: 'food',
      }),
    };

    let capturedMethod = '';
    const mockFetch = async (_url: string, init?: RequestInit) => {
      capturedMethod = init?.method ?? '';
      return new Response(
        JSON.stringify({
          id: 'item_1',
          version: 3,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(cmd);

    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe('PATCH');
    if (result.ok) {
      expect(result.receipt.resultingVersion).toBe(3);
    }
  });

  it('resolves historical receipt successfully when found', async () => {
    const mockFetch = async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/v1/merchant/sync/receipts/resolve');
      expect(init?.method).toBe('POST');
      return new Response(
        JSON.stringify({
          status: 'ACCEPTED',
          receiptId: 'mov_historical_1',
          resultingOnHand: 25,
          resultingReserved: 0,
          serverTimestamp: '2026-08-28T10:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.resolveReceipt(baseCommand);

    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.receipt.receiptId).toBe('mov_historical_1');
      expect(result.receipt.resultingOnHand).toBe(25);
    }
  });

  it('returns found: false when historical receipt does not exist (404)', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: 'No receipt found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.resolveReceipt(baseCommand);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.found).toBe(false);
    }
  });

  it('returns errorCode IDEMPOTENCY_FINGERPRINT_MISMATCH on fingerprint mismatch', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({ code: 'IDEMPOTENCY_FINGERPRINT_MISMATCH', message: 'Payload does not match receipt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.resolveReceipt(baseCommand);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('IDEMPOTENCY_FINGERPRINT_MISMATCH');
    }
  });

  it('fails closed immediately without dispatching on unsupported payload schema version', async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    };

    const invalidCmd: OfflineCommandRecord = {
      ...baseCommand,
      payloadSchemaVersion: 99,
    };

    const transport = new SyncTransport(mockFetch);
    const result = await transport.dispatch(invalidCmd);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('COMMAND_SCHEMA_UNSUPPORTED');
      expect(result.status).toBe(400);
    }
    expect(fetchCalled).toBe(false);
  });
});
