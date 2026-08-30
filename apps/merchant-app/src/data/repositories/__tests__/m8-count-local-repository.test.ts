import { DatabaseBootstrapper } from '../../database/bootstrap';
import { createNodeSqliteDatabase } from '../../database/node-driver';
import type { MerchantPartitionContext } from '../../models/partition-context';
import { CountLocalRepository } from '../count-local-repository';

describe('M8 CountLocalRepository', () => {
  const contextA: MerchantPartitionContext = {
    accountId: 'acc-1',
    organizationId: 'org-1',
    outletId: 'outlet-1',
  };

  const contextB: MerchantPartitionContext = {
    accountId: 'acc-2',
    organizationId: 'org-2',
    outletId: 'outlet-2',
  };

  it('creates, updates lines, and marks stock count draft submitted with reconciled lines', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const repo = new CountLocalRepository(db);

    const draft = await repo.createOrResumeDraft(contextA, 'session-1', 'cursor-100');
    expect(draft.sessionId).toBe('session-1');
    expect(draft.status).toBe('DRAFT');
    expect(draft.cutoffCursor).toBe('cursor-100');

    // Add lines
    await repo.saveDraftLine(contextA, 'session-1', 'listing-1', 15, 10);
    await repo.saveDraftLine(contextA, 'session-1', 'listing-2', 8, 8);

    const lines = await repo.listDraftLines(contextA, 'session-1');
    expect(lines).toHaveLength(2);
    expect(lines[0].listingId).toBe('listing-1');
    expect(lines[0].countedQuantity).toBe(15);
    expect(lines[0].cutoffOnHand).toBe(10);

    // Mark submitting
    await repo.markSubmitting(contextA, 'session-1', 'cmd-submit-1');
    const submitting = await repo.getDraft(contextA, 'session-1');
    expect(submitting?.status).toBe('SUBMITTING');
    expect(submitting?.submitCommandId).toBe('cmd-submit-1');

    // Mark submitted with reconciled lines
    await repo.markSubmitted(contextA, 'session-1', [
      { listingId: 'listing-1', reconciledDelta: 5, resultingOnHand: 15 },
      { listingId: 'listing-2', reconciledDelta: 0, resultingOnHand: 8 },
    ]);

    const submitted = await repo.getDraft(contextA, 'session-1');
    expect(submitted?.status).toBe('SUBMITTED');
    expect(submitted?.submittedAt).toBeDefined();

    const reconciledLines = await repo.listDraftLines(contextA, 'session-1');
    expect(reconciledLines[0].reconciledDelta).toBe(5);
    expect(reconciledLines[0].resultingOnHand).toBe(15);
    expect(reconciledLines[1].reconciledDelta).toBe(0);
    expect(reconciledLines[1].resultingOnHand).toBe(8);

    await db.close();
  });

  it('enforces partition isolation across merchant outlets and accounts', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const repo = new CountLocalRepository(db);

    await repo.createOrResumeDraft(contextA, 'session-shared-id');
    await repo.saveDraftLine(contextA, 'session-shared-id', 'listing-1', 20, 10);

    const draftA = await repo.getDraft(contextA, 'session-shared-id');
    const draftB = await repo.getDraft(contextB, 'session-shared-id');

    expect(draftA).not.toBeNull();
    expect(draftB).toBeNull();

    const linesA = await repo.listDraftLines(contextA, 'session-shared-id');
    const linesB = await repo.listDraftLines(contextB, 'session-shared-id');

    expect(linesA).toHaveLength(1);
    expect(linesB).toHaveLength(0);

    await db.close();
  });

  it('supports review required and rejection transitions', async () => {
    const db = createNodeSqliteDatabase(':memory:');
    const bootstrapper = new DatabaseBootstrapper();
    await bootstrapper.bootstrap(db);

    const repo = new CountLocalRepository(db);

    await repo.createOrResumeDraft(contextA, 'session-review');
    await repo.markReviewRequired(contextA, 'session-review', 'COUNT_CUTOFF_CONFLICT', 'Negative stock detected');

    const review = await repo.getDraft(contextA, 'session-review');
    expect(review?.status).toBe('REVIEW_REQUIRED');
    expect(review?.lastErrorCode).toBe('COUNT_CUTOFF_CONFLICT');

    await repo.markRejected(contextA, 'session-review', 'UNAUTHORIZED', 'Actor lacks permissions');
    const rejected = await repo.getDraft(contextA, 'session-review');
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.lastErrorCode).toBe('UNAUTHORIZED');

    await db.close();
  });
});
