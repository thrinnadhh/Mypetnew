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
    } else {
      type = typeOrOptions;
      payload = payloadOrOperation as TPayload;
      operation = operationOrExistingId as (idempotencyKey: string) => Promise<TResult>;
      jobId = (payload as any)?.jobId ?? null;
      captainId = (payload as any)?.captainId ?? null;
      existingCommandId = existingCommandIdArg;
      existingIdempotencyKey = existingIdempotencyKeyArg;
    }

    // In-flight deduplication mutex: prevent double-tap race conditions
    const inFlightKey = `${type}:${jobId ?? 'global'}`;
    const existingFlight = this.inFlightExecutions.get(inFlightKey);
    if (existingFlight) {
      return existingFlight as Promise<CommandOutcome<TResult>>;
    }

    const executionPromise = (async (): Promise<CommandOutcome<TResult>> => {
      // Check for existing pending or uncompleted command in the store for this job & type
      let command: MutationCommand<TPayload> | undefined;

      if (existingCommandId) {
        command = (await commandStore.get(existingCommandId)) as MutationCommand<TPayload> | undefined;
      } else {
        command = (await commandStore.getByJobAndType(jobId, type)) as MutationCommand<TPayload> | undefined;
      }

      const commandId = command?.commandId || existingCommandId || `cmd-${Crypto.randomUUID()}`;
      const idempotencyKey = command?.idempotencyKey || existingIdempotencyKey || `idemp-${Crypto.randomUUID()}`;
      const fingerprint = computePayloadFingerprint(type, jobId, payload);

      if (!command) {
        command = {
          commandId,
          id: commandId,
          commandType: type,
          type,
          captainId: captainId ?? null,
          jobId: jobId ?? null,
          idempotencyKey,
          payload,
          payloadFingerprint: fingerprint,
          state: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastAttemptAt: null,
          attemptCount: 0,
          lastErrorCode: null,
          lastError: null,
        };
        // MUST be written locally BEFORE any HTTP transmission
        await commandStore.save(command);
      }

      // Check if definitively offline before transmission
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

      // Prepare for transmission
      command.state = 'SENDING';
      command.attemptCount = (command.attemptCount || 0) + 1;
      command.lastAttemptAt = new Date().toISOString();
      command.updatedAt = new Date().toISOString();
      // Durably save SENDING state before network operation
      await commandStore.save(command);

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

        // 409 Conflict handling
        if (error.kind === 'Conflict') {
          // If conflict indicates business rejection, mark REJECTED
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
