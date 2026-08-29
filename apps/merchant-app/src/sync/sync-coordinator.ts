import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import { DraftLocalRepository } from '../data/repositories/draft-local-repository';
import { MediaReconciliationCoordinator } from '../catalog/media-sync';
import { DraftSyncReconciler } from './draft-sync-reconciler';
import { SyncRetryPolicy } from './retry-policy';
import { SyncTransport } from './sync-transport';
import { SyncChangeFeedReconciler } from './sync-change-feed-reconciler';

export type SyncSummary = {
  commandsProcessed: number;
  acknowledged: number;
  rejected: number;
  retryable: number;
  blocked: number;
  changesApplied: number;
  lastFeedError?: string;
};

export class SyncCoordinator {
  private readonly outboxRepo: CommandOutboxRepository;
  private readonly draftRepo: DraftLocalRepository;
  private readonly draftReconciler: DraftSyncReconciler;
  private readonly mediaCoordinator: MediaReconciliationCoordinator;
  private readonly reconciler: SyncChangeFeedReconciler;
  private readonly workerId: string;
  private readonly clock: () => number;
  private readonly activeRuns = new Map<string, Promise<SyncSummary>>();

  constructor(
    private readonly db: SqliteDatabase,
    private readonly transport: SyncTransport = new SyncTransport(),
    private readonly retryPolicy: SyncRetryPolicy = new SyncRetryPolicy(),
    reconciler?: SyncChangeFeedReconciler,
    workerId?: string,
    clock?: () => number,
  ) {
    this.clock = clock ?? (() => Date.now());
    this.outboxRepo = new CommandOutboxRepository(db, this.clock);
    this.draftRepo = new DraftLocalRepository(db, this.clock);
    this.draftReconciler = new DraftSyncReconciler(db, this.clock);
    this.mediaCoordinator = new MediaReconciliationCoordinator(db, this.clock);
    this.reconciler = reconciler ?? new SyncChangeFeedReconciler(db, transport.getFetchFn());
    this.workerId = workerId ?? `worker-${Crypto.randomUUID()}`;
  }

  getOutboxRepository(): CommandOutboxRepository {
    return this.outboxRepo;
  }

  async sync(context: MerchantPartitionContext, batchSize = 10): Promise<SyncSummary> {
    const partitionKey = `${context.accountId}:${context.organizationId}:${context.outletId}`;
    const existingRun = this.activeRuns.get(partitionKey);
    if (existingRun) return existingRun;

    const runPromise = this.executeSync(context, batchSize).finally(() => {
      this.activeRuns.delete(partitionKey);
    });
    this.activeRuns.set(partitionKey, runPromise);
    return runPromise;
  }

  private async acknowledge(
    context: MerchantPartitionContext,
    cmd: Parameters<DraftSyncReconciler['acknowledgeCreate']>[1],
    receipt: Parameters<DraftSyncReconciler['acknowledgeCreate']>[2],
  ): Promise<void> {
    if (cmd.commandType === 'CATALOG_CREATE') {
      await this.draftReconciler.acknowledgeCreate(context, cmd, receipt);
    } else {
      await this.outboxRepo.markAcknowledged(context, cmd.commandId, receipt, receipt.resultingVersion);
    }
  }

  private async reject(
    context: MerchantPartitionContext,
    cmd: Parameters<DraftSyncReconciler['acknowledgeCreate']>[1],
    code: string,
    details: string,
  ): Promise<void> {
    await this.outboxRepo.markRejected(context, cmd.commandId, code, details);
    if (cmd.commandType === 'CATALOG_CREATE') {
      await this.draftRepo.markRejected(context, cmd.commandId, code, details);
    }
  }

  private async conflict(
    context: MerchantPartitionContext,
    cmd: Parameters<DraftSyncReconciler['acknowledgeCreate']>[1],
    code: string,
    details: string,
  ): Promise<void> {
    if (cmd.commandType === 'CATALOG_CREATE') {
      await this.draftReconciler.markConflict(context, cmd.commandId, code, details);
    } else {
      await this.outboxRepo.markNeedsReconciliation(context, cmd.commandId, code, details);
    }
  }

  private async executeSync(context: MerchantPartitionContext, batchSize: number): Promise<SyncSummary> {
    let commandsProcessed = 0;
    let acknowledged = 0;
    let rejected = 0;
    let retryable = 0;
    let blocked = 0;

    let hasMore = true;
    while (hasMore) {
      const claimedBatch = await this.outboxRepo.claimNextEligibleCommands(
        context,
        this.workerId,
        30000,
        batchSize,
      );

      if (claimedBatch.length === 0) break;

      for (const item of claimedBatch) {
        const cmd = item.command;
        commandsProcessed += 1;

        if (
          cmd.accountId !== context.accountId ||
          cmd.organizationId !== context.organizationId ||
          cmd.outletId !== context.outletId
        ) {
          await this.reject(context, cmd, 'PARTITION_CONTEXT_MISMATCH', 'Command does not belong to active partition context');
          rejected += 1;
          continue;
        }

        if (item.needsReceiptResolution) {
          const resolution = await this.transport.resolveReceipt(cmd);
          if (resolution.ok) {
            if (resolution.found) {
              await this.acknowledge(context, cmd, resolution.receipt);
              acknowledged += 1;
              continue;
            }
          } else {
            if (resolution.errorCode === 'IDEMPOTENCY_FINGERPRINT_MISMATCH') {
              await this.reject(context, cmd, 'IDEMPOTENCY_FINGERPRINT_MISMATCH', resolution.error.message);
              rejected += 1;
              continue;
            }

            const decision = this.retryPolicy.evaluateError(
              resolution.error,
              cmd.attemptCount,
              resolution.status,
            );

            if (resolution.status === 401 || resolution.status === 403 || decision.action === 'REJECT') {
              const errCode = decision.action === 'REJECT' ? decision.errorCode : resolution.errorCode;
              const errMsg = decision.action === 'REJECT' ? decision.errorMessage : resolution.error.message;
              await this.reject(context, cmd, errCode || 'AUTH_FAILURE', errMsg || 'Authorization failure');
              rejected += 1;
              continue;
            }
            if (decision.action === 'CONFLICT') {
              await this.conflict(context, cmd, decision.errorCode, decision.errorMessage);
              rejected += 1;
              continue;
            }

            const delay = decision.action === 'RETRY' ? decision.delayMs : 1000;
            await this.outboxRepo.markRetryable(
              context,
              cmd.commandId,
              new Date(this.clock() + delay).toISOString(),
              resolution.errorCode ?? resolution.error.name,
              resolution.error.message,
            );
            retryable += 1;
            continue;
          }
        }

        const result = await this.transport.dispatch(cmd);
        if (result.ok) {
          await this.acknowledge(context, cmd, result.receipt);
          acknowledged += 1;
        } else {
          const decision = this.retryPolicy.evaluateError(
            result.error,
            cmd.attemptCount,
            result.status,
            result.retryAfter,
          );
          if (decision.action === 'REJECT') {
            await this.reject(context, cmd, decision.errorCode, decision.errorMessage);
            rejected += 1;
          } else if (decision.action === 'CONFLICT') {
            await this.conflict(context, cmd, decision.errorCode, decision.errorMessage);
            rejected += 1;
          } else {
            const delay = decision.action === 'RETRY' ? decision.delayMs : 1000;
            await this.outboxRepo.markRetryable(
              context,
              cmd.commandId,
              new Date(this.clock() + delay).toISOString(),
              result.error.name,
              result.error.message,
            );
            retryable += 1;
          }
        }
      }

      if (claimedBatch.length < batchSize) hasMore = false;
    }

    const blockedCommands = await this.outboxRepo.listCommands(context, ['BLOCKED']);
    blocked = blockedCommands.length;

    let changesApplied = 0;
    let lastFeedError: string | undefined;
    try {
      const feedResult = await this.reconciler.reconcile(context);
      changesApplied = feedResult.appliedChanges;
    } catch (err: unknown) {
      lastFeedError = err instanceof Error ? err.message : String(err);
    }

    try {
      await this.mediaCoordinator.sync(context);
    } catch (err: unknown) {
      const mediaError = err instanceof Error ? err.message : String(err);
      lastFeedError = lastFeedError ? `${lastFeedError}; media: ${mediaError}` : `media: ${mediaError}`;
    }

    return { commandsProcessed, acknowledged, rejected, retryable, blocked, changesApplied, lastFeedError };
  }
}
