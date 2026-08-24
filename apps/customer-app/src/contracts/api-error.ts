export type ApiFieldErrors = Record<string, string[]>;

export interface ApiErrorPayload {
  code: string;
  message: string;
  traceId?: string;
  fieldErrors: ApiFieldErrors;
  details?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeFieldErrors(value: unknown): ApiFieldErrors {
  const source = record(value);
  if (!source) return {};

  return Object.fromEntries(
    Object.entries(source).flatMap(([field, messages]) => {
      if (typeof messages === 'string' && messages.trim()) return [[field, [messages.trim()]]];
      if (Array.isArray(messages)) {
        const normalized = messages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        return normalized.length > 0 ? [[field, normalized.map((item) => item.trim())]] : [];
      }
      return [];
    }),
  );
}

export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return undefined;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

export function normalizeApiErrorPayload(
  status: number,
  statusText: string,
  raw: unknown,
  traceHeader?: string | null,
): ApiErrorPayload {
  const source = record(raw);
  const nestedError = record(source?.error);
  const message =
    text(source?.message) ??
    text(nestedError?.message) ??
    (typeof source?.error === 'string' ? text(source.error) : undefined) ??
    (typeof raw === 'string' ? text(raw) : undefined) ??
    `Request failed${statusText ? `: ${statusText}` : ` (${status})`}`;

  const code =
    text(source?.code) ??
    text(source?.errorCode) ??
    text(nestedError?.code) ??
    `HTTP_${status}`;

  const traceId =
    text(source?.traceId) ??
    text(source?.requestId) ??
    text(source?.trace_id) ??
    text(nestedError?.traceId) ??
    text(traceHeader);

  const fieldErrors = normalizeFieldErrors(source?.fieldErrors ?? source?.errors ?? nestedError?.fieldErrors);
  const details = source?.details ?? nestedError?.details;

  return { code, message, traceId, fieldErrors, details };
}

export class ApiError extends Error {
  readonly code: string;
  readonly traceId?: string;
  readonly fieldErrors: ApiFieldErrors;
  readonly details?: unknown;

  constructor(
    readonly status: number,
    payload: ApiErrorPayload,
    readonly data?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(payload.message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.traceId = payload.traceId;
    this.fieldErrors = payload.fieldErrors;
    this.details = payload.details;
  }
}

async function readResponseBody(response: Response): Promise<string> {
  if (typeof response.text === 'function') return response.text();
  const responseWithJson = response as Response & { json?: () => Promise<unknown> };
  if (typeof responseWithJson.json === 'function') {
    const value = await responseWithJson.json();
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return '';
}

export async function apiErrorFromResponse(response: Response, fallbackMessage?: string): Promise<ApiError> {
  const body = await readResponseBody(response);
  let raw: unknown = body;
  if (body) {
    try {
      raw = JSON.parse(body);
    } catch {
      raw = body;
    }
  }

  const getHeader = (name: string) => (typeof response.headers?.get === 'function' ? response.headers.get(name) : null);

  const payload = normalizeApiErrorPayload(
    response.status,
    response.statusText,
    raw,
    getHeader('x-request-id') ?? getHeader('x-trace-id'),
  );
  const genericMessage = payload.message.startsWith('Request failed');
  const finalPayload = fallbackMessage && genericMessage
    ? { ...payload, message: fallbackMessage }
    : payload;

  return new ApiError(
    response.status,
    finalPayload,
    raw,
    parseRetryAfter(getHeader('retry-after')),
  );
}

export type ApiErrorKind = 'authentication' | 'authorization' | 'not-found' | 'conflict' | 'validation' | 'rate-limit' | 'server' | 'network' | 'unknown';

export function apiErrorKind(error: unknown): ApiErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'authentication';
    if (error.status === 403) return 'authorization';
    if (error.status === 404) return 'not-found';
    if (error.status === 409) return 'conflict';
    if (error.status === 422 || error.status === 400) return 'validation';
    if (error.status === 429) return 'rate-limit';
    if (error.status >= 500) return 'server';
    return 'unknown';
  }
  if (error instanceof TypeError) return 'network';
  return 'unknown';
}

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}