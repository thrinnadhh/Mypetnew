export type MerchantPartitionContext = Readonly<{
  accountId: string;
  organizationId: string;
  outletId: string;
}>;

export function createPartitionContext(
  accountId: string,
  organizationId: string,
  outletId: string,
): MerchantPartitionContext {
  if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
    throw new Error('PARTITION_CONTEXT_INVALID: accountId must be a non-empty string');
  }
  if (!organizationId || typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    throw new Error('PARTITION_CONTEXT_INVALID: organizationId must be a non-empty string');
  }
  if (!outletId || typeof outletId !== 'string' || outletId.trim().length === 0) {
    throw new Error('PARTITION_CONTEXT_INVALID: outletId must be a non-empty string');
  }
  return Object.freeze({
    accountId: accountId.trim(),
    organizationId: organizationId.trim(),
    outletId: outletId.trim(),
  });
}

export function isSamePartition(
  a: MerchantPartitionContext,
  b: MerchantPartitionContext,
): boolean {
  return (
    a.accountId === b.accountId &&
    a.organizationId === b.organizationId &&
    a.outletId === b.outletId
  );
}
