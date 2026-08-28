import * as Crypto from 'expo-crypto';
import type { SqliteDatabase } from '../database/driver';
import { TABLE_OFFLINE_COMMANDS, TABLE_OFFLINE_COMMAND_DEPENDENCIES } from '../database/schema';
import type { MerchantPartitionContext } from '../models/partition-context';
import {
  type ClaimedCommand,
  type EnqueueCommandInput,
  type OfflineCommandPayload,
  type OfflineCommandRecord,
  type OfflineCommandState,
  type OfflineCommandType,
  type ServerReceiptData,
  computeCanonicalPayloadJson,
  computeRequestFingerprint,
} from '../models/outbox-types';

type CommandDbRow = {
  command_id: string;
  account_id: string;
  organization_id: string;
  outlet_id: string;
  installation_id: string;
  idempotency_key: string;
  command_type: OfflineCommandType;
  payload_schema_version: number;
  payload_json: string;
  request_fingerprint: string;
  state: OfflineCommandState;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_details: string | null;
  durable_server_receipt: string | null;
  resulting_version: number | null;
};

function mapRowToRecord(row: CommandDbRow): OfflineCommandRecord {
  return Object.freeze({
    commandId: row.command_id,
    accountId: row.account_id,
    organizationId: row.organization_id,
    outletId: row.outlet_id,
    installationId: row.installation_id,
    idempotencyKey: row.idempotency_key,
    commandType: row.command_type,
    payloadSchemaVersion: row.payload_schema_version,
    payloadJson: row.payload_json,
    requestFingerprint: row.request_fingerprint,
    state: row.state,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetails: row.last_error_details,
    durableServerReceipt: row.durable_server_receipt,
    resultingVersion: row.resulting_version,
  });
}

export class CommandOutboxRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async enqueueCommand(
    context: MerchantPartitionContext,
    input: EnqueueCommandInput,
  ): Promise<OfflineCommandRecord> {
    const commandId = input.commandId ?? Crypto.randomUUID();
    const schemaVersion = input.payloadSchemaVersion ?? 1;
    const payloadJson = computeCanonicalPayloadJson(input.payload);
    const fingerprint = await computeRequestFingerprint(input.commandType, input.payload, schemaVersion);
    const nowIso = new Date().toISOString();

    // 1. Check existing by commandId
    const existingById = await this.getCommand(context, commandId);
    if (existingById) {
      if (
        existingById.commandType !== input.commandType ||
        existingById.payloadJson !== payloadJson ||
        existingById.payloadSchemaVersion !== schemaVersion ||
        existingById.idempotencyKey !== input.idempotencyKey ||
        existingById.requestFingerprint !== fingerprint
      ) {
        throw new Error(
          `COMMAND_IMMUTABILITY_VIOLATION: Command ${commandId} already exists with different immutable attributes`,
        );
      }
      return existingById;
    }

    // 2. Check existing by idempotencyKey
    const existingByKey = await this.getCommandByIdempotencyKey(context, input.idempotencyKey);
    if (existingByKey) {
      if (existingByKey.requestFingerprint !== fingerprint) {
        throw new Error(
          `IDEMPOTENCY_FINGERPRINT_MISMATCH: Idempotency key ${input.idempotencyKey} was already used with a different fingerprint`,
        );
      }
      return existingByKey;
    }

    // 3. Dependency cycle and validation
    const dependencies = input.dependsOnCommandIds ?? [];
    if (dependencies.includes(commandId)) {
      throw new Error(`COMMAND_DEPENDENCY_CYCLE: Command ${commandId} cannot depend on itself`);
    }

    if (dependencies.length > 0) {
      await this.detectDependencyCycles(context, commandId, dependencies);
    }

    // 4. Persistence in transaction
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO ${TABLE_OFFLINE_COMMANDS} (
          account_id, organization_id, outlet_id, command_id, installation_id,
          idempotency_key, command_type, payload_schema_version, payload_json,
          request_fingerprint, state, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?);`,
        [
          context.accountId,
          context.organizationId,
          context.outletId,
          commandId,
          input.installationId,
          input.idempotencyKey,
          input.commandType,
          schemaVersion,
          payloadJson,
          fingerprint,
          nowIso,
          nowIso,
        ],
      );

      for (const parentId of dependencies) {
        await tx.run(
          `INSERT INTO ${TABLE_OFFLINE_COMMAND_DEPENDENCIES} (
            account_id, organization_id, outlet_id, command_id, depends_on_command_id
          ) VALUES (?, ?, ?, ?, ?);`,
          [context.accountId, context.organizationId, context.outletId, commandId, parentId],
        );
      }
    });

    const created = await this.getCommand(context, commandId);
    if (!created) {
      throw new Error(`PERSISTENCE_ERROR: Could not retrieve enqueued command ${commandId}`);
    }
    return created;
  }

  async claimNextEligibleCommands(
    context: MerchantPartitionContext,
    leaseOwner: string,
    leaseDurationMs: number,
    limit = 10,
  ): Promise<ClaimedCommand[]> {
    const nowIso = new Date().toISOString();
    const leaseExpiresIso = new Date(Date.now() + leaseDurationMs).toISOString();

    return this.db.transaction(async (tx) => {
      // 1. Reclaim expired SENDING leases
      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'RETRYABLE', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND state = 'SENDING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?;`,
        [nowIso, context.accountId, context.organizationId, context.outletId, nowIso],
      );

      // 2. Cascade BLOCKED status if parent dependency is REJECTED
      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'BLOCKED', last_error_code = 'PARENT_COMMAND_REJECTED', updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND state IN ('PENDING', 'RETRYABLE')
           AND command_id IN (
             SELECT d.command_id
             FROM ${TABLE_OFFLINE_COMMAND_DEPENDENCIES} d
             JOIN ${TABLE_OFFLINE_COMMANDS} p
               ON p.account_id = d.account_id
              AND p.organization_id = d.organization_id
              AND p.outlet_id = d.outlet_id
              AND p.command_id = d.depends_on_command_id
             WHERE d.account_id = ? AND d.organization_id = ? AND d.outlet_id = ?
               AND p.state = 'REJECTED'
           );`,
        [
          nowIso,
          context.accountId,
          context.organizationId,
          context.outletId,
          context.accountId,
          context.organizationId,
          context.outletId,
        ],
      );

      // 3. Find candidate commands whose parent dependencies are all ACKNOWLEDGED
      const rows = await tx.all<CommandDbRow>(
        `SELECT c.*
         FROM ${TABLE_OFFLINE_COMMANDS} c
         WHERE c.account_id = ? AND c.organization_id = ? AND c.outlet_id = ?
           AND c.state IN ('PENDING', 'RETRYABLE')
           AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= ?)
           AND NOT EXISTS (
             SELECT 1
             FROM ${TABLE_OFFLINE_COMMAND_DEPENDENCIES} d
             LEFT JOIN ${TABLE_OFFLINE_COMMANDS} p
               ON p.account_id = d.account_id
              AND p.organization_id = d.organization_id
              AND p.outlet_id = d.outlet_id
              AND p.command_id = d.depends_on_command_id
             WHERE d.account_id = c.account_id
               AND d.organization_id = c.organization_id
               AND d.outlet_id = c.outlet_id
               AND d.command_id = c.command_id
               AND (p.state IS NULL OR p.state != 'ACKNOWLEDGED')
           )
         ORDER BY c.created_at ASC
         LIMIT ?;`,
        [context.accountId, context.organizationId, context.outletId, nowIso, limit],
      );

      const claimed: ClaimedCommand[] = [];

      for (const row of rows) {
        const leaseToken = Crypto.randomUUID();
        await tx.run(
          `UPDATE ${TABLE_OFFLINE_COMMANDS}
           SET state = 'SENDING',
               attempt_count = attempt_count + 1,
               lease_owner = ?,
               lease_expires_at = ?,
               last_attempt_at = ?,
               updated_at = ?
           WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
             AND command_id = ? AND state IN ('PENDING', 'RETRYABLE');`,
          [
            `${leaseOwner}:${leaseToken}`,
            leaseExpiresIso,
            nowIso,
            nowIso,
            context.accountId,
            context.organizationId,
            context.outletId,
            row.command_id,
          ],
        );

        claimed.push({
          command: mapRowToRecord({
            ...row,
            state: 'SENDING',
            attempt_count: row.attempt_count + 1,
            lease_owner: `${leaseOwner}:${leaseToken}`,
            lease_expires_at: leaseExpiresIso,
            last_attempt_at: nowIso,
            updated_at: nowIso,
          }),
          leaseToken,
        });
      }

      return claimed;
    });
  }

  async markAcknowledged(
    context: MerchantPartitionContext,
    commandId: string,
    receipt: ServerReceiptData,
    resultingVersion?: number,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const receiptJson = JSON.stringify(receipt);
    const version = resultingVersion ?? receipt.resultingVersion ?? null;

    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'ACKNOWLEDGED',
             durable_server_receipt = ?,
             resulting_version = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = NULL,
             last_error_details = NULL,
             updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
        [receiptJson, version, nowIso, context.accountId, context.organizationId, context.outletId, commandId],
      );
    });
  }

  async markRejected(
    context: MerchantPartitionContext,
    commandId: string,
    errorCode: string,
    errorDetails?: string,
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'REJECTED',
             last_error_code = ?,
             last_error_details = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
        [errorCode, errorDetails ?? null, nowIso, context.accountId, context.organizationId, context.outletId, commandId],
      );

      // Cascade block to dependents
      await tx.run(
        `UPDATE ${TABLE_OFFLINE_COMMANDS}
         SET state = 'BLOCKED',
             last_error_code = 'PARENT_COMMAND_REJECTED',
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND command_id IN (
             SELECT command_id FROM ${TABLE_OFFLINE_COMMAND_DEPENDENCIES}
             WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
               AND depends_on_command_id = ?
           );`,
        [
          nowIso,
          context.accountId,
          context.organizationId,
          context.outletId,
          context.accountId,
          context.organizationId,
          context.outletId,
          commandId,
        ],
      );
    });
  }

  async markRetryable(
    context: MerchantPartitionContext,
    commandId: string,
    nextAttemptAtIso: string,
    errorCode?: string,
    errorDetails?: string,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE ${TABLE_OFFLINE_COMMANDS}
       SET state = 'RETRYABLE',
           next_attempt_at = ?,
           last_error_code = ?,
           last_error_details = ?,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
      [nextAttemptAtIso, errorCode ?? null, errorDetails ?? null, nowIso, context.accountId, context.organizationId, context.outletId, commandId],
    );
  }

  async markNeedsReconciliation(
    context: MerchantPartitionContext,
    commandId: string,
    errorCode: string,
    errorDetails?: string,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE ${TABLE_OFFLINE_COMMANDS}
       SET state = 'NEEDS_RECONCILIATION',
           last_error_code = ?,
           last_error_details = ?,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
      [errorCode, errorDetails ?? null, nowIso, context.accountId, context.organizationId, context.outletId, commandId],
    );
  }

  async getCommand(
    context: MerchantPartitionContext,
    commandId: string,
  ): Promise<OfflineCommandRecord | null> {
    const row = await this.db.get<CommandDbRow>(
      `SELECT * FROM ${TABLE_OFFLINE_COMMANDS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, commandId],
    );
    return row ? mapRowToRecord(row) : null;
  }

  async getCommandByIdempotencyKey(
    context: MerchantPartitionContext,
    idempotencyKey: string,
  ): Promise<OfflineCommandRecord | null> {
    const row = await this.db.get<CommandDbRow>(
      `SELECT * FROM ${TABLE_OFFLINE_COMMANDS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND idempotency_key = ?;`,
      [context.accountId, context.organizationId, context.outletId, idempotencyKey],
    );
    return row ? mapRowToRecord(row) : null;
  }

  async listCommands(
    context: MerchantPartitionContext,
    states?: OfflineCommandState[],
  ): Promise<OfflineCommandRecord[]> {
    if (states && states.length > 0) {
      const placeholders = states.map(() => '?').join(',');
      const rows = await this.db.all<CommandDbRow>(
        `SELECT * FROM ${TABLE_OFFLINE_COMMANDS}
         WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
           AND state IN (${placeholders})
         ORDER BY created_at ASC;`,
        [context.accountId, context.organizationId, context.outletId, ...states],
      );
      return rows.map(mapRowToRecord);
    }
    const rows = await this.db.all<CommandDbRow>(
      `SELECT * FROM ${TABLE_OFFLINE_COMMANDS}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
       ORDER BY created_at ASC;`,
      [context.accountId, context.organizationId, context.outletId],
    );
    return rows.map(mapRowToRecord);
  }

  async getCommandDependencies(
    context: MerchantPartitionContext,
    commandId: string,
  ): Promise<string[]> {
    const rows = await this.db.all<{ depends_on_command_id: string }>(
      `SELECT depends_on_command_id FROM ${TABLE_OFFLINE_COMMAND_DEPENDENCIES}
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
      [context.accountId, context.organizationId, context.outletId, commandId],
    );
    return rows.map((r) => r.depends_on_command_id);
  }

  async recoverStaleLeases(context: MerchantPartitionContext, nowIso = new Date().toISOString()): Promise<number> {
    const result = await this.db.run(
      `UPDATE ${TABLE_OFFLINE_COMMANDS}
       SET state = 'RETRYABLE', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE account_id = ? AND organization_id = ? AND outlet_id = ?
         AND state = 'SENDING' AND (lease_expires_at IS NULL OR lease_expires_at <= ?);`,
      [nowIso, context.accountId, context.organizationId, context.outletId, nowIso],
    );
    return result.changes;
  }

  private async detectDependencyCycles(
    context: MerchantPartitionContext,
    newCommandId: string,
    directParents: string[],
  ): Promise<void> {
    const visited = new Set<string>();
    const stack = [...directParents];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === newCommandId) {
        throw new Error(
          `COMMAND_DEPENDENCY_CYCLE: Dependency path from ${directParents.join(',')} leads back to ${newCommandId}`,
        );
      }
      if (!visited.has(current)) {
        visited.add(current);
        const parentRows = await this.db.all<{ depends_on_command_id: string }>(
          `SELECT depends_on_command_id FROM ${TABLE_OFFLINE_COMMAND_DEPENDENCIES}
           WHERE account_id = ? AND organization_id = ? AND outlet_id = ? AND command_id = ?;`,
          [context.accountId, context.organizationId, context.outletId, current],
        );
        for (const row of parentRows) {
          stack.push(row.depends_on_command_id);
        }
      }
    }
  }
}
