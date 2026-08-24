import { AppError, AppErrorKind } from '../domain/result';

export { AppError, AppErrorKind };

export const ErrorCodes = {
  NETWORK_ERROR: 'NetworkUnavailable',
  TIMEOUT_ERROR: 'Timeout',
  AUTHENTICATION_REQUIRED: 'AuthenticationExpired',
  AUTHORIZATION_DENIED: 'AuthorizationDenied',
  RESOURCE_NOT_FOUND: 'ResourceNotFound',
  CONFLICT: 'Conflict',
  VALIDATION_ERROR: 'ValidationRejected',
  SERVER_ERROR: 'ServerFailure',
  UNKNOWN_OUTCOME: 'UnknownOutcome',
  CAPTAIN_LOCATION_REQUIRED: 'LocationRequired',
  LOCATION_INVALID: 'LocationInvalid',
} as const;

export class ApiError extends AppError {
  constructor(details: {
    code?: string;
    message: string;
    status?: number;
    traceId?: string;
    retryable?: boolean;
  }) {
    let kind: AppErrorKind = 'ServerFailure';
    if (details.status === 401) kind = 'AuthenticationExpired';
    else if (details.status === 403) kind = 'AuthorizationDenied';
    else if (details.status === 404) kind = 'ResourceNotFound';
    else if (details.status === 408) kind = 'Timeout';
    else if (details.status === 409) kind = 'Conflict';
    else if (details.status === 400 || details.status === 422) kind = 'ValidationRejected';
    else if (details.status === 0 || details.code === 'NETWORK_ERROR') kind = 'NetworkUnavailable';

    super({
      kind,
      code: details.code ?? kind,
      message: details.message,
      status: details.status,
      traceId: details.traceId,
      retryable: details.retryable,
    });
    this.name = 'ApiError';
  }
}

export function getFriendlyErrorMessage(err: any): string {
  if (!err) return 'An unexpected error occurred.';
  if (typeof err === 'string') return err;
  if (err instanceof AppError) return err.message;
  if (err.message) return err.message;
  return 'An unexpected error occurred.';
}
