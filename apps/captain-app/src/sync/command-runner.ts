import * as Crypto from 'expo-crypto';
import { CommandOutcome, CommandType, MutationCommand } from '../domain/command';
import { AppError } from '../domain/result';
import { commandStore } from './command-store';

export class CommandRunner {
  async execute<TPayload, TResult>(
    type: CommandType,
    payload: TPayload,
    operation: (idempotencyKey: string) => Promise<TResult>,
    existingCommandId?: string,
    existingIdempotencyKey?: string,
  ): Promise<CommandOutcome<TResult>> {
    const commandId = existingCommandId ?? `cmd-${Crypto.randomUUID()}`;
    const idempotencyKey = existingIdempotencyKey ?? `idemp-${Crypto.randomUUID()}`;

    const command: MutationCommand<TPayload> = {
      id: commandId,
      type,
      idempotencyKey,
      payload,
      state: 'SENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 1,
    };

    await commandStore.save(command);

    try {
      const data = await operation(idempotencyKey);

      command.state = 'ACKNOWLEDGED';
      command.updatedAt = new Date().toISOString();
      await commandStore.save(command);

      return {
        outcome: 'ACKNOWLEDGED',
        data,
        idempotencyKey,
      };
    } catch (err: any) {
      const error: AppError = err instanceof AppError ? err : AppError.network(err.message);

      command.updatedAt = new Date().toISOString();
      command.lastError = error;

      // Definitive client / business rejection from server
      if (
        error.kind === 'ValidationRejected' ||
        error.kind === 'AuthorizationDenied' ||
        error.kind === 'Conflict' ||
        error.kind === 'ResourceNotFound'
      ) {
        command.state = 'REJECTED';
        await commandStore.save(command);

        return {
          outcome: 'REJECTED',
          error,
          idempotencyKey,
        };
      }

      // Network loss, timeout, or server unavailable: state is UNCONFIRMED
      command.state = 'UNKNOWN';
      await commandStore.save(command);

      return {
        outcome: 'UNKNOWN',
        commandId,
        idempotencyKey,
        error,
      };
    }
  }
}

export const commandRunner = new CommandRunner();
