import * as Crypto from 'expo-crypto';
import {
  clearSession,
  getApiBaseUrl,
  getAuthGeneration,
  getRuntimeAccessToken,
  getRuntimeAccountId,
  refreshCaptainSession,
} from '../auth/session';
import { AppError } from '../domain/result';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
  idempotencyKey?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

type RequestContext = {
  generation: number;
  accountId: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_READ_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30_000;
const responseContexts = new WeakMap<Response, RequestContext>();

function authenticationExpired(message: string, code = 'AUTHENTICATION_REQUIRED'): AppError {
  return new AppError({
    kind: 'AuthenticationExpired',
    code,
    message,
    status: 401,
    retryable: false,
  });
}

function assertRelativeEndpoint(endpoint: string): void {
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
    throw new AppError({
      kind: 'ValidationRejected',
      code: 'UNAPPROVED_API_ORIGIN',
      message: 'Captain API endpoints must be root-relative paths on the configured backend origin',
      status: 400,
      retryable: false,
    });
  }
}

function toHeaderRecord(headersInit?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headersInit) return headers;

  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  if (Array.isArray(headersInit)) {
    for (const [key, value] of headersInit) headers[key] = value;
    return headers;
  }

  return { ...headersInit } as Record<string, string>;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (existing && existing !== name) delete headers[existing];
  headers[name] = value;
}

function assertContextCurrent(context: RequestContext): void {
  if (
    getAuthGeneration() !== context.generation ||
    getRuntimeAccountId() !== context.accountId ||
    getRuntimeAccessToken() === null
  ) {
    throw authenticationExpired(
      'This response belongs to a session that is no longer active.',
      'STALE_AUTH_RESPONSE',
    );
  }
}

function rememberResponseContext(response: Response, context: RequestContext | null): Response {
  if (context) responseContexts.set(response, context);
  return response;
}

function assertResponseContextCurrent(response: Response): void {
  const context = responseContexts.get(response);
  if (context) assertContextCurrent(context);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
): Promise<Response> {
  if (externalSignal?.aborted) throw AppError.cancelled();

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (externalSignal?.aborted) throw AppError.cancelled();
    if (timedOut) throw AppError.timeout();
    return response;
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    if (error?.name === 'AbortError') {
      if (externalSignal?.aborted) throw AppError.cancelled();
      throw AppError.timeout();
    }
    throw AppError.network(
      error?.message || 'Unable to connect to the server. Please check your network.',
    );
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function retryAfterMs(response: Response, retryNumber: number, baseDelayMs: number): number {
  const retryAfter = response.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }

    const absoluteTime = Date.parse(retryAfter);
    if (!Number.isNaN(absoluteTime)) {
      return Math.min(Math.max(0, absoluteTime - Date.now()), MAX_RETRY_DELAY_MS);
    }
  }

  const exponential = baseDelayMs * 2 ** Math.max(0, retryNumber - 1);
  const jittered = exponential * (0.75 + Math.random() * 0.5);
  return Math.min(Math.round(jittered), MAX_RETRY_DELAY_MS);
}

async function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw AppError.cancelled();
  if (delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(AppError.cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryableReadStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function captainApiFetch(
  endpoint: string,
  options: RequestOptions = {},
): Promise<Response> {
  assertRelativeEndpoint(endpoint);

  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    skipAuth = false,
    idempotencyKey,
    maxRetries,
    retryBaseDelayMs = 250,
    headers: providedHeaders,
    signal: externalSignal,
    ...requestInit
  } = options;
  const method = (requestInit.method || 'GET').toUpperCase();
  const safeRead = method === 'GET' || method === 'HEAD';
  const allowedRetries = safeRead
    ? Math.max(0, Math.min(maxRetries ?? DEFAULT_READ_RETRIES, DEFAULT_READ_RETRIES))
    : 0;
  const url = `${getApiBaseUrl()}${endpoint}`;
  const baseHeaders = toHeaderRecord(providedHeaders);
  const traceId = findHeader(baseHeaders, 'X-Trace-Id') || `trace-${Crypto.randomUUID()}`;

  setHeader(baseHeaders, 'Accept', 'application/json');
  setHeader(baseHeaders, 'X-Trace-Id', traceId);
  if (idempotencyKey) setHeader(baseHeaders, 'Idempotency-Key', idempotencyKey);

  let retryNumber = 0;

  while (true) {
    let requestContext: RequestContext | null = null;
    let tokenUsed: string | null = null;
    const headers = { ...baseHeaders };

    if (!skipAuth) {
      tokenUsed = getRuntimeAccessToken();
      if (!tokenUsed) {
        try {
          tokenUsed = (await refreshCaptainSession()).accessToken;
        } catch {
          throw authenticationExpired('Your session has expired. Please sign in again.');
        }
      }

      const accountId = getRuntimeAccountId();
      if (!accountId || !tokenUsed) {
        throw authenticationExpired('Your session has expired. Please sign in again.');
      }

      requestContext = { generation: getAuthGeneration(), accountId };
      setHeader(headers, 'Authorization', `Bearer ${tokenUsed}`);
    }

    try {
      let response = await fetchWithTimeout(
        url,
        { ...requestInit, headers },
        timeoutMs,
        externalSignal,
      );

      if (requestContext) assertContextCurrent(requestContext);

      if (response.status === 401 && requestContext && tokenUsed) {
        const currentToken = getRuntimeAccessToken();
        let retryToken: string;

        if (currentToken && currentToken !== tokenUsed) {
          retryToken = currentToken;
        } else {
          try {
            retryToken = (await refreshCaptainSession()).accessToken;
          } catch {
            throw authenticationExpired('Your session has expired. Please sign in again.');
          }
        }

        assertContextCurrent(requestContext);
        const retryHeaders = { ...headers };
        setHeader(retryHeaders, 'Authorization', `Bearer ${retryToken}`);
        response = await fetchWithTimeout(
          url,
          { ...requestInit, headers: retryHeaders },
          timeoutMs,
          externalSignal,
        );
        assertContextCurrent(requestContext);

        if (response.status === 401) {
          if (
            getAuthGeneration() === requestContext.generation &&
            getRuntimeAccessToken() === retryToken
          ) {
            await clearSession();
          }
          throw authenticationExpired(
            'Your refreshed session was rejected. Please sign in again.',
            'SECOND_UNAUTHORIZED_RESPONSE',
          );
        }
      }

      if (safeRead && retryNumber < allowedRetries && isRetryableReadStatus(response.status)) {
        retryNumber += 1;
        await waitForRetry(retryAfterMs(response, retryNumber, retryBaseDelayMs), externalSignal);
        continue;
      }

      return rememberResponseContext(response, requestContext);
    } catch (error) {
      const appError = error instanceof AppError ? error : AppError.network();
      const transientReadFailure =
        appError.kind === 'NetworkUnavailable' || appError.kind === 'Timeout';
      if (safeRead && retryNumber < allowedRetries && transientReadFailure) {
        retryNumber += 1;
        const delayMs = retryAfterMs(
          { headers: new Headers() } as Response,
          retryNumber,
          retryBaseDelayMs,
        );
        await waitForRetry(delayMs, externalSignal);
        continue;
      }
      throw appError;
    }
  }
}

export async function handleApiResponse<T>(response: Response): Promise<T> {
  assertResponseContextCurrent(response);
  const traceId = response.headers?.get?.('x-trace-id') || undefined;

  if (response.ok) {
    if (response.status === 204) return {} as T;

    try {
      const body = (await response.json()) as T;
      assertResponseContextCurrent(response);
      return body;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        kind: 'ServerFailure',
        code: 'MALFORMED_SUCCESS_RESPONSE',
        message: 'The server returned an invalid success response',
        status: response.status,
        traceId,
        retryable: false,
      });
    }
  }

  let errorBody: unknown = null;
  try {
    errorBody = await response.json();
  } catch {
    // Non-JSON error bodies are normalized from the HTTP status below.
  }
  assertResponseContextCurrent(response);

  throw AppError.fromHttp(response.status, errorBody, traceId);
}
