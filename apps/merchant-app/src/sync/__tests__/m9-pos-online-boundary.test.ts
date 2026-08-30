import type { OfflineCommandRecord } from '../../data/models/outbox-types';
import { SUPPORTED_COMMAND_PAYLOAD_VERSIONS } from '../../data/models/outbox-types';
import { SyncTransport } from '../sync-transport';

describe('M9 POS online authority boundary', () => {
  it('does not expose POS completion as a durable offline command', async () => {
    expect(Object.keys(SUPPORTED_COMMAND_PAYLOAD_VERSIONS)).not.toContain('POS_SALE');

    let networkCalled = false;
    const transport = new SyncTransport(async () => {
      networkCalled = true;
      return new Response('{}', { status: 200 });
    });
    const forged = {
      commandId: 'm9-pos-offline',
      accountId: 'account-1',
      organizationId: 'organization-1',
      outletId: 'outlet-1',
      installationId: 'installation-1',
      idempotencyKey: 'm9-pos-offline',
      commandType: 'POS_SALE',
      payloadSchemaVersion: 1,
      payloadJson: JSON.stringify({ outletId: 'outlet-1', lines: [] }),
      requestFingerprint: 'forged',
      state: 'PENDING',
      attemptCount: 0,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
      lastAttemptAt: null,
      nextAttemptAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorDetails: null,
      durableServerReceipt: null,
      resultingVersion: null,
    } as unknown as OfflineCommandRecord;

    const result = await transport.dispatch(forged);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error.name).toBe('COMMAND_SCHEMA_UNSUPPORTED');
    }
    expect(networkCalled).toBe(false);
  });
});
