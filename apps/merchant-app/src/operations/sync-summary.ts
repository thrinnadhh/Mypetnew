import type { FreshnessOptions, ProjectionFreshness } from '../data/models/sync-types';
import type { MerchantPartitionContext } from '../data/models/partition-context';
import type { CommandOutboxRepository } from '../data/repositories/command-outbox-repository';
import type { SyncStateRepository } from '../data/repositories/sync-state-repository';

const OPERATIONAL_PROJECTIONS = ['BARCODE', 'CATALOG', 'INVENTORY'] as const;

export type OperationalCommandSummary = {
  pending: number;
  sending: number;
  retry: number;
  reconciliation: number;
  rejected: number;
  blocked: number;
  acknowledged: number;
};

export type OperationalProjectionSummary = {
  outletId: string;
  projection: typeof OPERATIONAL_PROJECTIONS[number];
  freshness: ProjectionFreshness;
};

export type OperationalSyncSummary = {
  commands: OperationalCommandSummary;
  projections: OperationalProjectionSummary[];
};

export async function summarizeOperationalSync(
  contexts: readonly MerchantPartitionContext[],
  syncState: SyncStateRepository,
  outbox: CommandOutboxRepository,
  freshnessOptions: FreshnessOptions = {},
): Promise<OperationalSyncSummary> {
  const commands: OperationalCommandSummary = {
    pending: 0,
    sending: 0,
    retry: 0,
    reconciliation: 0,
    rejected: 0,
    blocked: 0,
    acknowledged: 0,
  };
  const projections: OperationalProjectionSummary[] = [];

  for (const context of contexts) {
    const counts = await outbox.getStateCounts(context);
    commands.pending += counts.PENDING;
    commands.sending += counts.SENDING;
    commands.retry += counts.RETRYABLE;
    commands.reconciliation += counts.NEEDS_RECONCILIATION;
    commands.rejected += counts.REJECTED;
    commands.blocked += counts.BLOCKED;
    commands.acknowledged += counts.ACKNOWLEDGED;

    for (const projection of OPERATIONAL_PROJECTIONS) {
      projections.push({
        outletId: context.outletId,
        projection,
        freshness: await syncState.getFreshness(context, projection, freshnessOptions),
      });
    }
  }

  return { commands, projections };
}
