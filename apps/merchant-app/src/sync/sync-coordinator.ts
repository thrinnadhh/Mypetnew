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
    this.clock = clock ?? (() => Date.now());
    this.outboxRepo = new CommandOutboxRepository(db, this.clock);
    this.reconciler = reconciler ?? new SyncChangeFeedReconciler(db, transport.getFetchFn());
    this.workerId = workerId ?? `worker-${Crypto.randomUUID()}`;
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

        // Attempt historical receipt resolution for commands with prior transport uncertainty (replays / retries / crashes)
        if (item.needsReceiptResolution) {
          const resolution = await this.transport.resolveReceipt(cmd);
          if (resolution.ok) {
            if (resolution.found) {
              // A. Resolver FOUND matching accepted receipt -> mark ACKNOWLEDGED, ZERO mutation dispatch
              await this.outboxRepo.markAcknowledged(
                context,
                cmd.commandId,
                resolution.receipt,
                resolution.receipt.resultingVersion,
              );
              acknowledged += 1;
              continue;
            } else {
              // B. Resolver definitive RECEIPT_NOT_FOUND / 404 -> only now allow ordinary mutation dispatch
              // Fall through to transport.dispatch(cmd) below
            }
          } else {
            // Unsuccessful receipt resolution: NEVER dispatch mutation on ambiguous/temporary errors
            if (resolution.errorCode === 'IDEMPOTENCY_FINGERPRINT_MISMATCH') {
              // C. IDEMPOTENCY_FINGERPRINT_MISMATCH -> REJECTED, ZERO dispatch
              await this.outboxRepo.markRejected(
                context,
                cmd.commandId,
                'IDEMPOTENCY_FINGERPRINT_MISMATCH',
                resolution.error.message,
              );
              rejected += 1;
              continue;
            }

            const decision = this.retryPolicy.evaluateError(
              resolution.error,
              cmd.attemptCount,
              resolution.status,
            );

            if (resolution.status === 401 || resolution.status === 403 || decision.action === 'REJECT') {
              // D. 401 / 403 -> terminal auth/permission handling, ZERO dispatch
              const errCode = decision.action === 'REJECT' ? decision.errorCode : (resolution.errorCode ?? 'AUTH_FAILURE');
              const errMsg = decision.action === 'REJECT' ? decision.errorMessage : (resolution.error?.message ?? 'Authorization failure');
              await this.outboxRepo.markRejected(
                context,
                cmd.commandId,
                errCode,
                errMsg,
              );
              rejected += 1;
              continue;
            } else if (decision.action === 'CONFLICT') {
              // G. Conflict / malformed -> mark NEEDS_RECONCILIATION, ZERO dispatch
              await this.outboxRepo.markNeedsReconciliation(
                context,
                cmd.commandId,
                decision.errorCode,
                decision.errorMessage,
              );
              rejected += 1;
              continue;
            } else {
              // E & F. Resolver network failure / 5xx / temporary -> RETRYABLE / unresolved, ZERO mutation dispatch
              const delay = decision.action === 'RETRY' ? decision.delayMs : 1000;
              const nextAttemptAtIso = new Date(this.clock() + delay).toISOString();
              await this.outboxRepo.markRetryable(
                context,
                cmd.commandId,
                nextAttemptAtIso,
                resolution.errorCode ?? resolution.error?.name,
                resolution.error?.message,
              );
              retryable += 1;
              continue;
            }
          }
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
