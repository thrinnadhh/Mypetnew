import { DatabaseBootstrapper } from '../../data/database/bootstrap';
import { createNodeSqliteDatabase } from '../../data/database/node-driver';
import { createPartitionContext } from '../../data/models/partition-context';
import { CommandOutboxRepository } from '../../data/repositories/command-outbox-repository';
import { OfflineCatalogDraftService } from '../offline-catalog-draft-service';
import { SyncCoordinator } from '../sync-coordinator';
import { SyncTransport } from '../sync-transport';

describe('M7 production SyncCoordinator offline onboarding reconciliation', () => {
  const context = createPartitionContext('acc_m7_sync', 'org_m7_sync', 'out_m7_sync');
  const tempListingId = 'local_00000000-0000-4000-8000-000000000799';
  const canonicalListingId = '99999999-9999-4999-8999-999999999999';

  const draftInput = {
    tempListingId,
    barcodeType: 'INTERNAL' as const,
    barcode: 'M7-SYNC-UNKNOWN',
    name: 'M7 Sync Product',
    kind: 'PRODUCT' as const,
    mrpPaise: 2000,
    sellingPricePaise: 1800,
    category: 'food',
    brand: null,
    description: null,
    petType: null,
    lifeStage: null,
    packLabel: null,
    sku: null,
  };

  function emptyFeedResponse(): Response {
    return new Response(JSON.stringify({
      changes: [],
      nextCursor: null,
      hasMore: false,
      currentHighWaterCursor: 'm7-empty-high-water',
      serverTime: '2026-08-29T00:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  it('persists mapping before parent ACK and drains newly-unblocked dependent command with canonical id', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const draftService = new OfflineCatalogDraftService(db, 'installation-sync');
    const queued = await draftService.queueDraft(context, draftInput);
    const outbox = new CommandOutboxRepository(db);
    await outbox.enqueueCommand(context, {
      commandId: 'm7-dependent-inventory',
      installationId: 'installation-sync',
      idempotencyKey: 'm7-dependent-inventory-key',
      commandType: 'INVENTORY_ADJUSTMENT',
      payload: {
        outletId: context.outletId,
        listingId: tempListingId,
        quantityDelta: 7,
        reason: 'MANUAL_INCREASE',
      },
      dependsOnCommandIds: [queued.command.commandId],
    });

    const dispatchedInventoryBodies: Array<Record<string, unknown>> = [];
    const fetchFn = jest.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/sync/catalog/drafts/reconcile')) {
        return new Response(JSON.stringify({
          status: 'ACCEPTED',
          receiptId: canonicalListingId,
          commandType: 'CATALOG_CREATE',
          entityId: canonicalListingId,
          resultingVersion: 0,
          serverTimestamp: '2026-08-29T00:00:00.000Z',
          outcome: 'CREATED',
          tempListingId,
          canonicalListingId,
          canonicalListing: { id: canonicalListingId },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/inventory/adjustments')) {
        dispatchedInventoryBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          id: 'movement-m7',
          resultingOnHand: 7,
          resultingReserved: 0,
          resultingVersion: 1,
          serverTimestamp: '2026-08-29T00:00:01.000Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/sync/changes')) return emptyFeedResponse();
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });

    const coordinator = new SyncCoordinator(db, new SyncTransport(fetchFn));
    const summary = await coordinator.sync(context);

    expect(summary.commandsProcessed).toBe(2);
    expect(summary.acknowledged).toBe(2);
    expect(summary.rejected).toBe(0);
    expect(dispatchedInventoryBodies).toHaveLength(1);
    expect(dispatchedInventoryBodies[0].listingId).toBe(canonicalListingId);
    expect(JSON.stringify(dispatchedInventoryBodies[0])).not.toContain(tempListingId);

    const mapping = await draftService.getDraftRepository().getMapping(context, tempListingId);
    expect(mapping?.canonicalListingId).toBe(canonicalListingId);
    expect((await draftService.getDraftRepository().getDraft(context, tempListingId))?.state).toBe('SYNCED');
    expect((await outbox.getCommand(context, queued.command.commandId))?.state).toBe('ACKNOWLEDGED');
    expect((await outbox.getCommand(context, 'm7-dependent-inventory'))?.state).toBe('ACKNOWLEDGED');
    await db.close();
  });

  it('preserves local metadata and marks explicit conflict on server 409', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const draftService = new OfflineCatalogDraftService(db, 'installation-conflict');
    const queued = await draftService.queueDraft(context, draftInput);
    const fetchFn = async (url: string) => {
      if (url.includes('/sync/catalog/drafts/reconcile')) {
        return new Response(JSON.stringify({
          outcome: 'CONFLICT',
          tempListingId,
          canonicalListingId,
          canonicalListing: { id: canonicalListingId, name: 'Existing canonical product' },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/sync/changes')) return emptyFeedResponse();
      return new Response('{}', { status: 404 });
    };

    const summary = await new SyncCoordinator(db, new SyncTransport(fetchFn)).sync(context);
    expect(summary.rejected).toBe(1);
    const draft = await draftService.getDraftRepository().getDraft(context, tempListingId);
    expect(draft?.state).toBe('CONFLICT');
    expect(draft?.name).toBe('M7 Sync Product');
    expect(draft?.conflictJson).toContain(canonicalListingId);
    expect((await new CommandOutboxRepository(db).getCommand(context, queued.command.commandId))?.state)
      .toBe('NEEDS_RECONCILIATION');
    await db.close();
  });

  it('marks draft rejected and creates no mapping when current server authorization returns 403', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    await new DatabaseBootstrapper().bootstrap(db);
    const draftService = new OfflineCatalogDraftService(db, 'installation-revoked');
    await draftService.queueDraft(context, draftInput);
    const fetchFn = async (url: string) => {
      if (url.includes('/sync/catalog/drafts/reconcile')) {
        return new Response(JSON.stringify({ code: 'MERCHANT_PERMISSION_REQUIRED', message: 'Permission revoked' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/sync/changes')) return emptyFeedResponse();
      return new Response('{}', { status: 404 });
    };

    const summary = await new SyncCoordinator(db, new SyncTransport(fetchFn)).sync(context);
    expect(summary.rejected).toBe(1);
    const draft = await draftService.getDraftRepository().getDraft(context, tempListingId);
    expect(draft?.state).toBe('REJECTED');
    expect(draft?.lastErrorCode).toBe('MERCHANT_PERMISSION_REQUIRED');
    expect(await draftService.getDraftRepository().getMapping(context, tempListingId)).toBeNull();
    await db.close();
  });
});
