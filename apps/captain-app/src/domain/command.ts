import { AppError } from './result';

export type CommandState =
  | 'PENDING'
  | 'SENDING'
  | 'UNKNOWN'
  | 'ACKNOWLEDGED'
  | 'REJECTED';

export type CommandType =
  | 'ACCEPT_OFFER'
  | 'REJECT_OFFER'
  | 'MARK_PICKED_UP'
  | 'MARK_DELIVERED'
  | 'UPDATE_AVAILABILITY'
  | 'SUBMIT_ONBOARDING';

export interface MutationCommand<T = unknown> {
  commandId: string;
  id: string; // compatibility alias
  commandType: CommandType;
  type: CommandType; // compatibility alias
  captainId?: string | null;
  jobId?: string | null;
  idempotencyKey: string;
  payload: T;
  payloadFingerprint: string;
  createdAt: string;
  lastAttemptAt?: string | null;
  attemptCount: number;
  state: CommandState;
  lastErrorCode?: string | null;
  lastError?: AppError | null;
  updatedAt?: string;
}

export type CommandOutcome<T> =
  | { outcome: 'ACKNOWLEDGED'; data: T; idempotencyKey: string; commandId: string }
  | { outcome: 'REJECTED'; error: AppError; idempotencyKey: string; commandId: string }
  | { outcome: 'UNKNOWN'; commandId: string; idempotencyKey: string; error: AppError }
  | { outcome: 'PENDING'; commandId: string; idempotencyKey: string; error?: AppError };

export const isTerminalOutcome = <T>(result: CommandOutcome<T>): boolean =>
  result.outcome === 'ACKNOWLEDGED' || result.outcome === 'REJECTED';

export function computePayloadFingerprint(
  commandType: CommandType,
  jobId: string | null | undefined,
  payload: unknown,
): string {
  try {
    const raw = JSON.stringify({
      type: commandType,
      jobId: jobId || null,
      payload: payload ?? null,
    });
    // Deterministic 32-bit FNV-1a hash formatted as hex
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  } catch {
    return `fp-${Date.now()}`;
  }
}
