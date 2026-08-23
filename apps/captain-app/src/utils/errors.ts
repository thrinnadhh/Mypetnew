export interface ApiErrorPayload {
  code: string;
  message: string;
  status?: number;
  traceId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly traceId?: string;

  constructor(payload: ApiErrorPayload) {
    super(payload.message || 'An unexpected error occurred');
    this.name = 'ApiError';
    this.code = payload.code || 'UNKNOWN_ERROR';
    this.status = payload.status || 500;
    this.traceId = payload.traceId;
  }
}

export const ErrorCodes = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  CAPTAIN_NOT_ACTIVE: 'CAPTAIN_NOT_ACTIVE',
  CAPTAIN_LOCATION_REQUIRED: 'CAPTAIN_LOCATION_REQUIRED',
  LOCATION_INVALID: 'LOCATION_INVALID',
  CAPTAIN_NOT_ELIGIBLE: 'CAPTAIN_NOT_ELIGIBLE',
  DISPATCH_OFFER_EXPIRED: 'DISPATCH_OFFER_EXPIRED',
  DISPATCH_OFFER_RESOLVED: 'DISPATCH_OFFER_RESOLVED',
  DISPATCH_CONFLICT: 'DISPATCH_CONFLICT',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
} as const;

export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCodes.AUTHENTICATION_REQUIRED:
        return 'Please sign in to continue.';
      case ErrorCodes.CAPTAIN_LOCATION_REQUIRED:
        return 'Your current location is required to go online.';
      case ErrorCodes.LOCATION_INVALID:
        return 'Invalid location coordinates received.';
      case ErrorCodes.CAPTAIN_NOT_ELIGIBLE:
        return 'You are currently not eligible for this delivery request.';
      case ErrorCodes.DISPATCH_OFFER_EXPIRED:
        return 'This delivery offer has expired.';
      case ErrorCodes.DISPATCH_OFFER_RESOLVED:
        return 'This delivery offer was already resolved.';
      case ErrorCodes.DISPATCH_CONFLICT:
        return 'Delivery assignment status changed. Refreshing your dashboard.';
      case ErrorCodes.NETWORK_ERROR:
        return 'Network connection issue. Please check your internet connection.';
      case ErrorCodes.TIMEOUT_ERROR:
        return 'Request timed out. Please try again.';
      default:
        return error.message || 'Something went wrong. Please try again.';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred.';
}
