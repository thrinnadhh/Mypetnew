import * as Crypto from 'expo-crypto';
import {
  CommandOutcome,
  CommandType,
  MutationCommand,
  computePayloadFingerprint,
} from '../domain/command';
import { AppError } from '../domain/result';
import { commandStore } from './command-store';
import { connectivity } from './connectivity';

export interface ExecuteOptions<TPayload> {
  type: CommandType;
  payload: TPayload;
  resourceType?: string;
  resourceId?: string;
  jobId?: string | null;
  captainId?: string | null;
  existingCommandId?: string;
  existingIdempotencyKey?: string;
}

export class CommandRunner {
  private inFlightExecutions = new Map<string, Promise<CommandOutcome<any>>>();

  async execute<TPayload, TResult>(
    typeOrOptions: CommandType | ExecuteOptions<TPayload>,
    payloadOrOperation?: TPayload | ((idempotencyKey: string) => Promise<TResult>),
    operationOrExistingId?: ((idempotencyKey: string) => Promise<TResult>) | string,
    existingCommandIdArg?: string,
    existingIdempotencyKeyArg?: string,
  ): Promise<CommandOutcome<TResult>> {
    let type: CommandType;
    let payload: TPayload;
    let operation: (idempotencyKey: string) => Promise<TResult>;
    let resourceType: string;
    let resourceId: string;
    let jobId: string | null = null;
    let captainId: string | null = null;
    let existingCommandId: string | undefined;
    let existingIdempotencyKey: string | undefined;

    if (typeof typeOrOptions === 'object') {
      type = typeOrOptions.type;
      payload = typeOrOptions.payload;
      operation = payloadOrOperation as (idempotencyKey: string) => Promise<TResult>;
      jobId = typeOrOptions.jobId ?? (payload as any)?.jobId ?? null;
      captainId = typeOrOptions.captainId ?? (payload as any)?.captainId ?? null;
      existingCommandId = typeOrOptions.existingCommandId;
      existingIdempotencyKey = typeOrOptions.existingIdempotencyKey;

      resourceType =
        typeOrOptions.resourceType ||
        (type === 'ACCEPT_OFFER' || type === 'REJECT_OFFER'
          ? 'DISPATCH_OFFER'
          : type === 'UPDATE_AVAILABILITY'
            ? 'CAPTAIN_AVAILABILITY'
            : type === 'SUBMIT_ONBOARDING'
              ? 'ONBOARDING'
              : 'DELIVERY_JOB');

      resourceId =
        typeOrOptions.resourceId ||
        (payload as any)?.offerId ||
        (payload as any)?.jobId ||
        jobId ||
        captainId ||
        (payload as any)?.captainId ||
        'global';
    } else {
      type = typeOrOptions;
      payload = payloadOrOperation as TPayload;
      operation = operationOrExistingId as (idempotencyKey: string) => Promise<TResult>;
      jobId = (payload as any)?.jobId ?? null;
      captainId = (payload as any)?.captainId ?? null;
      existingCommandId = existingCommandIdArg;
      existingIdempotencyKey = existingIdempotencyKeyArg;

      resourceType =
        type === 'ACCEPT_OFFER' || type === 'REJECT_OFFER'
          ? 'DISPATCH_OFFER'
          : type === 'UPDATE_AVAILABILITY'
            ? 'CAPTAIN_AVAILABILITY'
            : type === 'SUBMIT_ONBOARDING'
              ? 'ONBOARDING'
              : 'DELIVERY_JOB';

      resourceId =
        (payload as any)?.offerId ||
        (payload as any)?.jobId ||
        jobId ||
        captainId ||
        'global';
    }

    // In-flight deduplication mutex scoped to (commandType + resourceType + resourceId)
    // Ensures independent resources (e.g. Offer A and Offer B) execute independently
    const inFlightKey = `${type}:${resourceType}:${resourceId}`;
    const existingFlight = this.inFlightExecutions.get(inFlightKey);
    if (existingFlight) {
      return existingFlight as Promise<CommandOutcome<TResult>>;
    }

    const executionPromise = (async (): Promise<CommandOutcome<TResult>> => {
      // 1. Resolve existing active or specified command
      let command: MutationCommand<TPayload> | undefined;

      if (existingCommandId) {
        command = (await commandStore.get(existingCommandId)) as MutationCommand<TPayload> | undefined;
      } else if (existingIdempotencyKey) {
        command = (await commandStore.getByIdempotencyKey(existingIdempotencyKey)) as MutationCommand<TPayload> | undefined;
      } else {
        command = (await commandStore.findActiveCommand(type, resourceType, resourceId)) as MutationCommand<TPayload> | undefined;
      }

      const currentFingerprint = computePayloadFingerprint(type, resourceType, resourceId, payload);

      // 2. Enforce payload fingerprint matching on existing command
      if (command) {
        if (command.payloadFingerprint && command.payloadFingerprint !== currentFingerprint) {
          // FAIL CLOSED: Do NOT silently reuse the old idempotency key for a different payload
          throw AppError.fromHttp(400, {
            code: 'IDEMPOTENCY_FINGERPRINT_MISMATCH',
            message: `IDEMPOTENCY_FINGERPRINT_MISMATCH: Payload fingerprint mismatch for command ${command.commandId}. Expected ${command.payloadFingerprint}, received ${currentFingerprint}`,
          });
        }
      }

      const commandId = command?.commandId || existingCommandId || `cmd-${Crypto.randomUUID()}`;
      const idempotencyKey = command?.idempotencyKey || existingIdempotencyKey || `idemp-${Crypto.randomUUID()}`;

      if (!command) {
        if (type === 'UPDATE_AVAILABILITY' && !existingCommandId && !existingIdempotencyKey) {
          const pendingCommands = await commandStore.listPending();
          for (const pendingCmd of pendingCommands) {
            if (
              pendingCmd.commandType === 'UPDATE_AVAILABILITY' ||
              pendingCmd.type === 'UPDATE_AVAILABILITY'
            ) {
              pendingCmd.state = 'SUPERSEDED';
              pendingCmd.updatedAt = new Date().toISOString();
              await commandStore.save(pendingCmd);
            }
          }
        }

        command = {
          commandId,
          id: commandId,
          commandType: type,
          type,
          resourceType,
          resourceId,
          captainId: captainId ?? null,
          jobId: jobId ?? null,
          idempotencyKey,
          payload,
          payloadFingerprint: currentFingerprint,
          state: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastAttemptAt: null,
          attemptCount: 0,
          lastErrorCode: null,
          lastError: null,
        };

        // INVARIANT: MUST be durably committed before network transmission.
        // If persistence fails, this throws and BLOCKS transmission.
        await commandStore.save(command);
      }

      // 3. Check if offline before transmission
      if (!connectivity.online) {
        command.state = 'PENDING';
        command.updatedAt = new Date().toISOString();
        await commandStore.save(command);

        return {
          outcome: 'PENDING',
          commandId,
          idempotencyKey,
          error: AppError.network('Device is currently offline. Command saved as PENDING.'),
        };
      }

      // 4. Prepare for transmission: mark SENDING and persist
      command.state = 'SENDING';
      command.attemptCount = (command.attemptCount || 0) + 1;
      command.lastAttemptAt = new Date().toISOString();
      command.updatedAt = new Date().toISOString();

      // Durably save SENDING state before network operation
      await commandStore.save(command);

      // 5. Execute HTTP network operation
      try {
        const data = await operation(idempotencyKey);

        command.state = 'ACKNOWLEDGED';
        command.lastErrorCode = null;
        command.lastError = null;
        command.updatedAt = new Date().toISOString();
        await commandStore.save(command);

        return {
          outcome: 'ACKNOWLEDGED',
          data,
          idempotencyKey,
          commandId,
        };
      } catch (err: any) {
        const error: AppError = err instanceof AppError ? err : AppError.network(err.message);

        command.updatedAt = new Date().toISOString();
        command.lastErrorCode = error.code || error.kind;
        command.lastError = error;

        // Canonical 4xx rejections from server
        if (
          error.kind === 'ValidationRejected' ||
          error.kind === 'AuthorizationDenied' ||
          error.kind === 'ResourceNotFound'
        ) {
          command.state = 'REJECTED';
          await commandStore.save(command);

          return {
            outcome: 'REJECTED',
            error,
            idempotencyKey,
            commandId,
          };
        }

        // 409 Conflict handling (e.g. offer claimed by other captain)
        if (error.kind === 'Conflict') {
          command.state = 'REJECTED';
          await commandStore.save(command);

          return {
            outcome: 'REJECTED',
            error,
            idempotencyKey,
            commandId,
          };
        }

        // Network loss, timeout, 5xx server failure, abort
        // Transmission may have occurred; outcome is unconfirmed
        command.state = 'UNKNOWN';
        await commandStore.save(command);

        return {
          outcome: 'UNKNOWN',
          commandId,
          idempotencyKey,
          error,
        };
      }
    })();

    this.inFlightExecutions.set(inFlightKey, executionPromise);

    try {
      return await executionPromise;
    } finally {
      this.inFlightExecutions.delete(inFlightKey);
    }
  }
}

export const commandRunner = new CommandRunner();
