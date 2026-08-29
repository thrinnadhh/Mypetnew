import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../data/database/driver';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import type { OfflineCommandRecord, ServerReceiptData } from '../data/models/outbox-types';
import { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import { OfflineCatalogDraftRepository } from '../data/repositories/offline-catalog-draft-repository';
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
  private readonly draftRepo: OfflineCatalogDraftRepository;
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
    this.draftRepo = new OfflineCatalogDraftRepository(db, this.clock);
    this.reconciler = reconciler ?? new SyncChangeFeedReconciler(db, transport.getFetchFn());
    this.workerId = workerId ?? `worker-${Crypto.randomUUID()}`;
  }

  getOutboxRepository(): CommandOutboxRepository {
    return this.outboxRepo;
  }

  getOfflineCatalogDraftRepository(): OfflineCatalogDraftRepository {
    return this.draftRepo;
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
    originalCommand: OfflineCommandRecord,
    receipt: ServerReceiptData,
  ): Promise<void> {
    // Persist the temp->canonical mapping before ACK makes dependent commands eligible.
    if (originalCommand.commandType === 'CATALOG_CREATE') {
      await this.draftRepo.applyCreateReceipt(context, originalCommand, receipt);
    }
    await this.outboxRepo.markAcknowledged(
      context,
      originalCommand.commandId,
      receipt,
      receipt.resultingVersion,
    );
  }

  private async rejectDraftIfNeeded(
    context: MerchantPartitionContext,
    command: OfflineCommandRecord,
    errorCode: string,
  ): Promise<void> {
    if (command.commandType === 'CATALOG_CREATE') {
      await this.draftRepo.markCreateRejected(context, command, errorCode);
    }
  }

  private async executeSync(context: MerchantPartitionContext, batchSize: number): Promise<SyncSummary> {
    let commandsProcessed = 0;
    let acknowledged = 0;
    let rejected = 0;
    let retryable = 0;
    let blocked = 0;

    // Drain until there is no currently eligible work. ACKing one command can unblock another,
    // so batch-size alone is not a valid termination signal.
    while (true) {
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
          await this.rejectDraftIfNeeded(context, cmd, 'PARTITION_CONTEXT_MISMATCH');
          await this.outboxRepo.markRejected(
            context,
            cmd.commandId,
            'PARTITION_CONTEXT_MISMATCH',
            'Command does not belong to active partition context',
          );
          rejected += 1;
          continue;
        }

        const effectiveCmd = await this.draftRepo.resolveCommandIdentity(context, cmd);

        if (item.needsReceiptResolution) {
          const resolution = await this.transport.resolveReceipt(effectiveCmd);
          if (resolution.ok) {
            if (resolution.found) {
              await this.acknowledge(context, cmd, resolution.receipt);
              acknowledged += 1;
              continue;
            }
          } else {
            if (resolution.errorCode === 'IDEMPOTENCY_FINGERPRINT_MISMATCH') {
              await this.rejectDraftIfNeeded(context, cmd, 'IDEMPOTENCY_FINGERPRINT_MISMATCH');
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
              const errCode = decision.action === 'REJECT'
                ? decision.errorCode
                : (resolution.errorCode ?? 'AUTH_FAILURE');
              const errMsg = decision.action === 'REJECT'
                ? decision.errorMessage
                : (resolution.error?.message ?? 'Authorization failure');
              await this.rejectDraftIfNeeded(context, cmd, errCode);
              await this.outboxRepo.markRejected(context, cmd.commandId, errCode, errMsg);
              rejected += 1;
              continue;
            }

            if (decision.action === 'CONFLICT') {
              if (cmd.commandType === 'CATALOG_CREATE') {
                await this.draftRepo.markCreateConflict(context, cmd, {
                  code: decision.errorCode,
                  message: decision.errorMessage,
                });
              }
              await this.outboxRepo.markNeedsReconciliation(
                context,
                cmd.commandId,
                decision.errorCode,
                decision.errorMessage,
              );
              rejected += 1;
              continue;
            }

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

        const result = await this.transport.dispatch(effectiveCmd);

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
            await this.rejectDraftIfNeeded(context, cmd, decision.errorCode);
            await this.outboxRepo.markRejected(
              context,
              cmd.commandId,
              decision.errorCode,
              decision.errorMessage,
            );
            rejected += 1;
          } else if (decision.action === 'CONFLICT') {
            if (cmd.commandType === 'CATALOG_CREATE') {
              await this.draftRepo.markCreateConflict(context, cmd, result.errorData ?? {
                code: decision.errorCode,
                message: decision.errorMessage,
              });
            }
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
