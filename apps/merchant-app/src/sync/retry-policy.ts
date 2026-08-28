export type RetryDecision =
  | { action: 'RETRY'; delayMs: number; reason: string }
  | { action: 'REJECT'; errorCode: string; errorMessage: string }
  | { action: 'CONFLICT'; errorCode: string; errorMessage: string }
  | { action: 'AUTH_REFRESH'; reason: string };

export type RetryPolicyOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  clock?: () => number;
  random?: () => number;
};

export class SyncRetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly clock: () => number;
  private readonly random: () => number;

  constructor(options: RetryPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 60000;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.clock = options.clock ?? (() => Date.now());
    this.random = options.random ?? (() => Math.random());
  }

  calculateBackoffMs(attempt: number): number {
    const safeAttempt = Math.max(1, attempt);
    const exponential = this.baseDelayMs * Math.pow(2, safeAttempt - 1);
    const bounded = Math.min(this.maxDelayMs, exponential);
    // Jitter between 0% and 25% of bounded delay
    const jitter = bounded * 0.25 * this.random();
    return Math.min(this.maxDelayMs, Math.floor(bounded + jitter));
  }

  parseRetryAfterHeader(headerValue: string | null | undefined): number | null {
    if (!headerValue || headerValue.trim().length === 0) {
      return null;
    }
    const trimmed = headerValue.trim();

    // 1. Integer seconds format (e.g. "120")
    const seconds = parseInt(trimmed, 10);
    if (!Number.isNaN(seconds) && String(seconds) === trimmed && seconds >= 0) {
      return Math.min(this.maxDelayMs, seconds * 1000);
    }

    // 2. HTTP-Date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
    const targetEpoch = Date.parse(trimmed);
    if (!Number.isNaN(targetEpoch)) {
      const now = this.clock();
      const diffMs = targetEpoch - now;
      return Math.max(0, Math.min(this.maxDelayMs, diffMs));
    }

    return null;
  }

  evaluateError(
    error: unknown,
    attempt: number,
    httpStatus?: number,
    retryAfterHeader?: string | null,
  ): RetryDecision {
    if (attempt >= this.maxAttempts) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        action: 'REJECT',
        errorCode: 'MAX_RETRY_ATTEMPTS_EXCEEDED',
        errorMessage: `Max retry attempts (${this.maxAttempts}) exceeded: ${msg}`,
      };
    }

    if (httpStatus !== undefined) {
      // 400 Bad Request, 422 Unprocessable Entity, 404 Not Found
      if (httpStatus === 400 || httpStatus === 422 || httpStatus === 404) {
        const code = (error as { name?: string })?.name || 'VALIDATION_REJECTED';
        const msg = error instanceof Error ? error.message : String(error);
        return {
          action: 'REJECT',
          errorCode: code,
          errorMessage: msg,
        };
      }

      // 401 Unauthorized (final after merchantApiFetch refresh attempt)
      if (httpStatus === 401) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          action: 'REJECT',
          errorCode: 'AUTH_UNAUTHORIZED',
          errorMessage: `Authentication session expired or invalid: ${msg}`,
        };
      }

      // 403 Forbidden (terminal authorization denial - do not retry)
      if (httpStatus === 403) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          action: 'REJECT',
          errorCode: 'PERMISSION_DENIED',
          errorMessage: `Permission denied for command execution: ${msg}`,
        };
      }

      // 409 Conflict
      if (httpStatus === 409) {
        const code = (error as { name?: string })?.name || 'CONCURRENT_CONFLICT';
        const msg = error instanceof Error ? error.message : String(error);
        return {
          action: 'CONFLICT',
          errorCode: code,
          errorMessage: msg,
        };
      }

      // 429 Too Many Requests / Rate Limited
      if (httpStatus === 429) {
        const parsedDelay = this.parseRetryAfterHeader(retryAfterHeader);
        const delayMs = parsedDelay ?? this.calculateBackoffMs(attempt);
        return {
          action: 'RETRY',
          delayMs,
          reason: `HTTP 429 Rate Limited; Retry-After: ${delayMs}ms`,
        };
      }

      // 408 Request Timeout, 5xx Server Errors
      if (httpStatus === 408 || httpStatus >= 500) {
        const delayMs = this.calculateBackoffMs(attempt);
        return {
          action: 'RETRY',
          delayMs,
          reason: `HTTP ${httpStatus} Server Error; backoff ${delayMs}ms`,
        };
      }
    }

    // Network disconnection / timeout / offline errors
    const delayMs = this.calculateBackoffMs(attempt);
    const msg = error instanceof Error ? error.message : String(error);
    return {
      action: 'RETRY',
      delayMs,
      reason: `Network/transport error: ${msg}; backoff ${delayMs}ms`,
    };
  }
}
