import type { SqliteDatabase } from '../database/driver';
import { TABLE_INVENTORY_COUNT_DRAFTS, TABLE_INVENTORY_COUNT_DRAFT_LINES } from '../database/schema';
import type { MerchantPartitionContext } from '../models/partition-context';

export type CountDraftStatus = 'DRAFT' | 'SUBMITTING' | 'SUBMITTED' | 'REVIEW_REQUIRED' | 'REJECTED';

export type LocalCountDraft = {
  accountId: string;
  organizationId: string;
  outletId: string;
  sessionId: string;
  status: CountDraftStatus;
  cutoffCursor: string | null;
  cutoffTimestamp: string;
  submitCommandId: string | null;
  lastErrorCode: string | null;
  lastErrorDetails: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
};

export type LocalCountDraftLine = {
  accountId: string;
  organizationId: string;
  outletId: string;
  sessionId: string;
  listingId: string;
  countedQuantity: number;
  cutoffOnHand: number;
  reconciledDelta: number | null;
  resultingOnHand: number | null;
  createdAt: string;
  updatedAt: string;
};

export class CountLocalRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async createOrResumeDraft(
    context: MerchantPartitionContext,
    sessionId: string,
    cutoffCursor: string | null = null,
  ): Promise<LocalCountDraft> {
    const existing = await this.getDraft(context, sessionId);
    if (existing) return existing;

    const now = new Date(this.clock()).toISOString();
    await this.db.run(
      `INSERT INTO ${TABLE_INVENTORY_COUNT_DRAFTS} (
        account_id, organization_id, outlet_id, session_id, status,
        cutoff_cursor, cutoff_timestamp, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?);`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        sessionId,
        cutoffCursor,
        now,
        now,
        now,
      ],
    );

    return {
      accountId: context.accountId,
      organizationId: context.organizationId,
      outletId: context.outletId,
      sessionId,
      status: 'DRAFT',
      cutoffCursor,
      cutoffTimestamp: now,
      submitCommandId: null,
      lastErrorCode: null,
      lastErrorDetails: null,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
    };
  }

  async getDraft(
    context: MerchantPartitionContext,
    sessionId: string,
  ): Promise<LocalCountDraft | null> {
    const row = await this.db.get<{
      account_id: string;
      organization_id: string;
      outlet_id: string;
      session_id: string;
      status: CountDraftStatus;
      cutoff_cursor: string | null;
      cutoff_timestamp: string;
      submit_command_id: string | null;
      last_error_code: string | null;
      last_error_details: string | null;
      created_at: string;
      updated_at: string;
      submitted_at: string | null;
    }>(
      `SELECT * FROM ${TABLE_INVENTORY_COUNT_DRAFTS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, sessionId],
    );

    if (!row) return null;
    return {
      accountId: row.account_id,
      organizationId: row.organization_id,
      outletId: row.outlet_id,
      sessionId: row.session_id,
      status: row.status,
      cutoffCursor: row.cutoff_cursor,
      cutoffTimestamp: row.cutoff_timestamp,
      submitCommandId: row.submit_command_id,
      lastErrorCode: row.last_error_code,
      lastErrorDetails: row.last_error_details,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
    };
  }

  async saveDraftLine(
    context: MerchantPartitionContext,
    sessionId: string,
    listingId: string,
    countedQuantity: number,
    cutoffOnHand: number,
  ): Promise<LocalCountDraftLine> {
    const now = new Date(this.clock()).toISOString();
    await this.db.run(
      `INSERT INTO ${TABLE_INVENTORY_COUNT_DRAFT_LINES} (
        account_id, organization_id, outlet_id, session_id, listing_id,
        counted_quantity, cutoff_on_hand, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, organization_id, outlet_id, session_id, listing_id) DO UPDATE
      SET counted_quantity = excluded.counted_quantity,
          updated_at = excluded.updated_at;`,
      [
        context.accountId,
        context.organizationId,
        context.outletId,
        sessionId,
        listingId,
        countedQuantity,
        cutoffOnHand,
        now,
        now,
      ],
    );

    await this.db.run(
      `UPDATE ${TABLE_INVENTORY_COUNT_DRAFTS}
       SET updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?;`,
      [now, context.accountId, context.organizationId, context.outletId, sessionId],
    );

    return {
      accountId: context.accountId,
      organizationId: context.organizationId,
      outletId: context.outletId,
      sessionId,
      listingId,
      countedQuantity,
      cutoffOnHand,
      reconciledDelta: null,
      resultingOnHand: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listDraftLines(
    context: MerchantPartitionContext,
    sessionId: string,
  ): Promise<LocalCountDraftLine[]> {
    const rows = await this.db.all<{
      account_id: string;
      organization_id: string;
      outlet_id: string;
      session_id: string;
      listing_id: string;
      counted_quantity: number;
      cutoff_on_hand: number;
      reconciled_delta: number | null;
      resulting_on_hand: number | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM ${TABLE_INVENTORY_COUNT_DRAFT_LINES}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?
       ORDER BY created_at, listing_id;`,
      [context.accountId, context.organizationId, context.outletId, sessionId],
    );

    return rows.map((r) => ({
      accountId: r.account_id,
      organizationId: r.organization_id,
      outletId: r.outlet_id,
      sessionId: r.session_id,
      listingId: r.listing_id,
      countedQuantity: r.counted_quantity,
      cutoffOnHand: r.cutoff_on_hand,
      reconciledDelta: r.reconciled_delta,
      resultingOnHand: r.resulting_on_hand,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async markSubmitting(
    context: MerchantPartitionContext,
    sessionId: string,
    submitCommandId: string,
  ): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    await this.db.run(
      `UPDATE ${TABLE_INVENTORY_COUNT_DRAFTS}
       SET status = 'SUBMITTING', submit_command_id = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?;`,
      [submitCommandId, now, context.accountId, context.organizationId, context.outletId, sessionId],
    );
  }

  async markSubmitted(
    context: MerchantPartitionContext,
    sessionId: string,
    reconciledLines: { listingId: string; reconciledDelta?: number; resultingOnHand?: number }[] = [],
  ): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE ${TABLE_INVENTORY_COUNT_DRAFTS}
         SET status = 'SUBMITTED', submitted_at = ?, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?;`,
        [now, now, context.accountId, context.organizationId, context.outletId, sessionId],
      );

      for (const line of reconciledLines) {
        await tx.run(
          `UPDATE ${TABLE_INVENTORY_COUNT_DRAFT_LINES}
           SET reconciled_delta = ?, resulting_on_hand = ?, updated_at = ?
           WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ? AND listing_id = ?;`,
          [
            line.reconciledDelta ?? null,
            line.resultingOnHand ?? null,
            now,
            context.accountId,
            context.organizationId,
            context.outletId,
            sessionId,
            line.listingId,
          ],
        );
      }
    });
  }

  async markReviewRequired(
    context: MerchantPartitionContext,
    sessionId: string,
    code: string,
    details: string,
  ): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    await this.db.run(
      `UPDATE ${TABLE_INVENTORY_COUNT_DRAFTS}
       SET status = 'REVIEW_REQUIRED', last_error_code = ?, last_error_details = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?;`,
      [code, details, now, context.accountId, context.organizationId, context.outletId, sessionId],
    );
  }

  async markRejected(
    context: MerchantPartitionContext,
    sessionId: string,
    code: string,
    details: string,
  ): Promise<void> {
    const now = new Date(this.clock()).toISOString();
    await this.db.run(
      `UPDATE ${TABLE_INVENTORY_COUNT_DRAFTS}
       SET status = 'REJECTED', last_error_code = ?, last_error_details = ?, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND session_id = ?;`,
      [code, details, now, context.accountId, context.organizationId, context.outletId, sessionId],
    );
  }
}
