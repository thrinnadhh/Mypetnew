import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
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
    this.outboxRepo = new CommandOutboxRepository(db);
    this.reconciler = reconciler ?? new SyncChangeFeedReconciler(db, transport.getFetchFn());
    this.workerId = workerId ?? `worker-${Crypto.randomUUID()}`;
    this.clock = clock ?? (() => Date.now());
  }

  getOutboxRepository(): CommandOutboxRepository {
    return this.outboxRepo;
  }

  async sync(context: MerchantPartitionContext, batchSize = 10): Promise<SyncSummary> {
    const partitionKey = `${context.accountId}:${context.organizationId}:${context.outletId}`;

    // Single-flight lock per partition
    const existingRun = this.activeRuns.get(partitionKey);
    if (existingRun) {
      return existingRun;
    }

    const runPromise = this.executeSync(context, batchSize).finally(() => {
      this.activeRuns.delete(partitionKey);
    });

    this.activeRuns.set(partitionKey, runPromise);
    return runPromise;
  }

  private async executeSync(context: MerchantPartitionContext, batchSize: number): Promise<SyncSummary> {
    let commandsProcessed = 0;
    let acknowledged = 0;
    let rejected = 0;
    let retryable = 0;
    let blocked = 0;

    // 1. Drain outbox
    let hasMore = true;
    while (hasMore) {
      const claimedBatch = await this.outboxRepo.claimNextEligibleCommands(
        context,
        this.workerId,
        30000, // 30s lease
        batchSize,
      );

      if (claimedBatch.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of claimedBatch) {
        const cmd = item.command;
        commandsProcessed += 1;

        // Partition isolation check
        if (
          cmd.accountId !== context.accountId ||
          cmd.organizationId !== context.organizationId ||
          cmd.outletId !== context.outletId
        ) {
          await this.outboxRepo.markRejected(
            context,
            cmd.commandId,
            'PARTITION_CONTEXT_MISMATCH',
            'Command does not belong to active partition context',
          );
          rejected += 1;
          continue;
        }

        const result = await this.transport.dispatch(cmd);

        if (result.ok) {
          await this.outboxRepo.markAcknowledged(
            context,
            cmd.commandId,
            result.receipt,
            result.receipt.resultingVersion,
          );
          acknowledged += 1;
        } else {
          const decision = this.retryPolicy.evaluateError(
            result.error,
            cmd.attemptCount,
            result.status,
            result.retryAfter,
          );

          if (decision.action === 'REJECT') {
            await this.outboxRepo.markRejected(
              context,
              cmd.commandId,
              decision.errorCode,
              decision.errorMessage,
            );
            rejected += 1;
          } else if (decision.action === 'CONFLICT') {
            await this.outboxRepo.markNeedsReconciliation(
              context,
              cmd.commandId,
              decision.errorCode,
              decision.errorMessage,
            );
            rejected += 1;
          } else if (decision.action === 'RETRY') {
            const nextAttemptAtIso = new Date(this.clock() + decision.delayMs).toISOString();
            await this.outboxRepo.markRetryable(
              context,
              cmd.commandId,
              nextAttemptAtIso,
              result.error.name,
              result.error.message,
            );
            retryable += 1;
          }
        }
      }

      if (claimedBatch.length < batchSize) {
        hasMore = false;
      }
    }

    // Count blocked commands
    const blockedCommands = await this.outboxRepo.listCommands(context, ['BLOCKED']);
    blocked = blockedCommands.length;

    // 2. Reconcile change feed
    let changesApplied = 0;
    let lastFeedError: string | undefined;
    try {
      const feedResult = await this.reconciler.reconcile(context);
      changesApplied = feedResult.appliedChanges;
    } catch (err: unknown) {
      lastFeedError = err instanceof Error ? err.message : String(err);
    }

    return {
      commandsProcessed,
      acknowledged,
      rejected,
      retryable,
      blocked,
      changesApplied,
      lastFeedError,
    };
  }
}
