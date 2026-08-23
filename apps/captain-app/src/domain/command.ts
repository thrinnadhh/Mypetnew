import { AppError } from './result';

export type CommandState =
  | 'PENDING'
  | 'SENDING'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'UNKNOWN'
  | 'REQUIRES_RECONCILIATION';

export type CommandType =
  | 'ACCEPT_OFFER'
  | 'REJECT_OFFER'
  | 'MARK_PICKED_UP'
  | 'MARK_DELIVERED'
  | 'UPDATE_AVAILABILITY'
  | 'SUBMIT_ONBOARDING';

export interface MutationCommand<T = unknown> {
  id: string;
  type: CommandType;
  idempotencyKey: string;
  payload: T;
  state: CommandState;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastError?: AppError;
}

export type CommandOutcome<T> =
  | { outcome: 'ACKNOWLEDGED'; data: T; idempotencyKey: string }
  | { outcome: 'REJECTED'; error: AppError; idempotencyKey: string }
  | { outcome: 'UNKNOWN'; commandId: string; idempotencyKey: string; error: AppError };

export const isTerminalOutcome = <T>(result: CommandOutcome<T>): boolean =>
  result.outcome === 'ACKNOWLEDGED' || result.outcome === 'REJECTED';
