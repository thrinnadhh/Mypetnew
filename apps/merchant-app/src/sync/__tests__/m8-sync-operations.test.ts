import type { OfflineCommandRecord } from '../../data/models/outbox-types';
import { SyncTransport } from '../sync-transport';

describe('M8 SyncTransport Operations and Count Dispatches', () => {
  const baseCommand: Omit<OfflineCommandRecord, 'commandType' | 'payloadJson'> = {
    commandId: 'cmd-1',
    accountId: 'acc-1',
    organizationId: 'org-1',
    outletId: 'outlet-1',
    installationId: 'inst-1',
    idempotencyKey: 'idemp-1',
    payloadSchemaVersion: 1,
    requestFingerprint: 'fp-1',
    state: 'PENDING',
    attemptCount: 0,
    createdAt: '2026-08-29T12:00:00Z',
    updatedAt: '2026-08-29T12:00:00Z',
    lastAttemptAt: null,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorDetails: null,
    durableServerReceipt: null,
    resultingVersion: null,
  };

  it('dispatches INVENTORY_RECEIVING command and parses receipt', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'mov-rec-1',
          resultingOnHand: 25,
          resultingReserved: 0,
          updatedAt: '2026-08-29T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const transport = new SyncTransport(fetchMock);
    const cmd: OfflineCommandRecord = {
      ...baseCommand,
      commandType: 'INVENTORY_RECEIVING',
      payloadJson: JSON.stringify({
        outletId: 'outlet-1',
        listingId: 'listing-1',
        quantity: 10,
        batchNumber: 'BATCH-001',
        expiryDate: '2027-12-31',
      }),
    };

    const res = await transport.dispatch(cmd);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.receipt.receiptId).toBe('mov-rec-1');
      expect(res.receipt.resultingOnHand).toBe(25);
    }
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchant/inventory/receiving',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-MyPet-Command-Type': 'INVENTORY_RECEIVING',
          'X-MyPet-Payload-Schema-Version': '1',
          'Idempotency-Key': 'idemp-1',
        }),
      }),
    );
  });

  it('dispatches INVENTORY_TRANSFER command and parses receipt', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transfer: { id: 'tr-1', status: 'COMPLETED' },
          sourceMovement: { id: 'mov-src', resultingOnHand: 15 },
          destinationMovement: { id: 'mov-dst', resultingOnHand: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const transport = new SyncTransport(fetchMock);
    const cmd: OfflineCommandRecord = {
      ...baseCommand,
      commandType: 'INVENTORY_TRANSFER',
      payloadJson: JSON.stringify({
        sourceOutletId: 'outlet-1',
        destinationOutletId: 'outlet-2',
        sourceListingId: 'listing-1',
        quantity: 5,
      }),
    };

    const res = await transport.dispatch(cmd);
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchant/inventory/transfers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-MyPet-Command-Type': 'INVENTORY_TRANSFER',
        }),
      }),
    );
  });

  it('dispatches INVENTORY_COUNT_SUBMIT command and parses receipt', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: 'session-123',
          status: 'SUBMITTED',
          submittedAt: '2026-08-29T12:00:00Z',
          lines: [{ listingId: 'listing-1', countAdjustmentDelta: 2, resultingOnHand: 12 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const transport = new SyncTransport(fetchMock);
    const cmd: OfflineCommandRecord = {
      ...baseCommand,
      commandType: 'INVENTORY_COUNT_SUBMIT',
      payloadJson: JSON.stringify({
        outletId: 'outlet-1',
        sessionId: 'session-123',
      }),
    };

    const res = await transport.dispatch(cmd);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.receipt.receiptId).toBe('session-123');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchant/inventory/counts/session-123/submit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-MyPet-Command-Type': 'INVENTORY_COUNT_SUBMIT',
        }),
      }),
    );
  });

  it('resolves durable receipt for INVENTORY_TRANSFER', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ACCEPTED',
          receiptId: 'tr-1',
          commandType: 'INVENTORY_TRANSFER',
          entityId: 'listing-1',
          serverTimestamp: '2026-08-29T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const transport = new SyncTransport(fetchMock);
    const cmd: OfflineCommandRecord = {
      ...baseCommand,
      commandType: 'INVENTORY_TRANSFER',
      payloadJson: JSON.stringify({
        sourceOutletId: 'outlet-1',
        destinationOutletId: 'outlet-2',
        sourceListingId: 'listing-1',
        quantity: 5,
      }),
    };

    const res = await transport.resolveReceipt(cmd);
    expect(res.ok).toBe(true);
    if (res.ok && res.found) {
      expect(res.receipt.receiptId).toBe('tr-1');
    }
  });
});
