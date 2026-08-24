export type AppErrorKind =
  | 'NetworkUnavailable'
  | 'Timeout'
  | 'Cancelled'
  | 'RateLimited'
  | 'AuthenticationExpired'
  | 'AuthorizationDenied'
  | 'ResourceNotFound'
  | 'Conflict'
  | 'ValidationRejected'
  | 'ServerFailure'
  | 'UnknownOutcome';

export interface AppErrorDetails {
  kind: AppErrorKind;
  message: string;
  code?: string;
  status?: number;
  traceId?: string;
  retryable?: boolean;
  originalError?: unknown;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly code: string;
  readonly status: number;
  readonly traceId?: string;
  readonly retryable: boolean;

  constructor(details: AppErrorDetails) {
    super(details.message);
    this.name = 'AppError';
    this.kind = details.kind;
    this.code = details.code ?? details.kind;
    this.status =
      details.status ??
      (details.kind === 'Timeout'
        ? 408
        : details.kind === 'NetworkUnavailable' || details.kind === 'Cancelled'
          ? 0
          : details.kind === 'RateLimited'
            ? 429
            : 500);
    this.traceId = details.traceId;
    this.retryable = details.retryable ?? (details.kind === 'NetworkUnavailable' || details.kind === 'Timeout' || details.kind === 'ServerFailure');
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static fromHttp(status: number, data?: any, traceId?: string): AppError {
    let kind: AppErrorKind = 'ServerFailure';
    const extractedMessage =
      data?.message ??
      data?.error?.message ??
      (typeof data?.error === 'string' ? data.error : undefined);
    const extractedCode = data?.code ?? data?.error?.code;

    let message = extractedMessage ?? `Request failed with status ${status}`;
    let retryable = false;

    switch (status) {
      case 400:
      case 422:
        kind = 'ValidationRejected';
        break;
      case 401:
        kind = 'AuthenticationExpired';
        message = extractedMessage ?? 'Session has expired or is invalid';
        break;
      case 403:
        kind = 'AuthorizationDenied';
        message = extractedMessage ?? 'Permission denied for this operation';
        break;
      case 404:
        kind = 'ResourceNotFound';
        message = extractedMessage ?? 'The requested resource was not found';
        break;
      case 408:
        kind = 'Timeout';
        message = extractedMessage ?? 'Request timed out';
        retryable = true;
        break;
      case 409:
        kind = 'Conflict';
        message = extractedMessage ?? 'State conflict occurred on the server';
        break;
      case 429:
        kind = 'RateLimited';
        message = extractedMessage ?? 'Too many requests. Please try again shortly.';
        retryable = true;
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        kind = 'ServerFailure';
        message = extractedMessage ?? 'Server encountered an error';
        retryable = true;
        break;
    }

    return new AppError({
      kind,
      code: extractedCode ?? kind,
      message,
      status,
      traceId,
      retryable,
    });
  }

  static network(message = 'Network unavailable. Please check your connection.'): AppError {
    return new AppError({
      kind: 'NetworkUnavailable',
      message,
      status: 0,
      retryable: true,
    });
  }

  static timeout(message = 'Request timed out waiting for server response.'): AppError {
    return new AppError({
      kind: 'Timeout',
      message,
      status: 408,
      retryable: true,
    });
  }

  static cancelled(message = 'Request was cancelled.'): AppError {
    return new AppError({
      kind: 'Cancelled',
      code: 'REQUEST_CANCELLED',
      message,
      status: 0,
      retryable: false,
    });
  }

  static unknownOutcome(commandId: string, message = 'Mutation response lost. Server status is unconfirmed.'): AppError {
    return new AppError({
      kind: 'UnknownOutcome',
      code: 'COMMAND_OUTCOME_UNKNOWN',
      message,
      status: 0,
      retryable: false,
    });
  }
}

export type Result<T, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ success: true, data });
export const err = <E = AppError>(error: E): Result<never, E> => ({ success: false, error });
