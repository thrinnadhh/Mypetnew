import { ApiError } from '@/contracts/api-error';
import { apiClient } from '@/services/api-client';
import { createProductOrder } from '@/services/customer-checkout';
import { checkoutErrorPresentation, requiresFreshQuote } from '@/services/checkout-safety';

/**
 * H2 idempotency-conflict presentation regressions.
 *
 * Drives the REAL createProductOrder against a stubbed global.fetch (idiom of
 * customer-checkout-contract.test.ts) so the ApiError parsing, the presentation
 * mapping and the fresh-quote routing decision are all executed end-to-end.
 *
 * Mutation notes:
 * - Adding IDEMPOTENCY_FINGERPRINT_MISMATCH to requiresFreshQuote fails test 1
 *   (a fingerprint conflict must be replayed with the SAME key, not requoted).
 * - Dropping QUOTE_EXPIRED from requiresFreshQuote fails test 2.
 */
describe('H2 checkout order conflicts present recoverable routing', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 409 ? 'Conflict' : 'OK',
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  async function rejectionOf(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw new Error(`Expected an ApiError but got: ${String(error)}`);
    }
    throw new Error('Expected the promise to reject.');
  }

  it('treats a 409 IDEMPOTENCY_FINGERPRINT_MISMATCH as a safe retry without a fresh quote', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(jsonResponse(
      {
        code: 'IDEMPOTENCY_FINGERPRINT_MISMATCH',
        message: 'Request fingerprint does not match the original operation.',
        traceId: 'trace-h2-1',
      },
      409,
    ));

    const error = await rejectionOf(createProductOrder(
      { quoteId: 'quote-1', cartSignature: 'sig-1' },
      'STORE_PICKUP',
      'PAY_ON_FULFILMENT',
    ));

    expect(error.status).toBe(409);
    expect(error.code).toBe('IDEMPOTENCY_FINGERPRINT_MISMATCH');
    expect(error.traceId).toBe('trace-h2-1');

    // Current truthful contract: the conflict code is unmapped by
    // checkoutErrorPresentation, so it falls through to the default recovery.
    // That is the SAFE routing: the user replays the same request and the
    // Idempotency-Key derived from the preserved quote keeps it idempotent.
    const presentation = checkoutErrorPresentation(error);
    expect(presentation.recovery).toBe('retry');
    expect(presentation.message).toBe('Request fingerprint does not match the original operation.');
    expect(requiresFreshQuote(error)).toBe(false);

    // A conflict is never auto-retried by transport: exactly one request, and
    // the replay key binds to the quote so a retry cannot fork a second order.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestedUrl).toContain('/api/v1/customer/orders');
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: 'quote-1', cartSignature: 'sig-1' });
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'checkout:quote-1' });
  });

  it('routes a QUOTE_EXPIRED conflict to a mandatory fresh quote instead of a blind retry', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { code: 'QUOTE_EXPIRED', message: 'The checkout quote has expired.' },
      409,
    ));

    const error = await rejectionOf(createProductOrder(
      { quoteId: 'quote-2', cartSignature: 'sig-2' },
      'MYPET_CAPTAIN_DELIVERY',
      'ONLINE_PAYMENT',
    ));

    expect(error.status).toBe(409);
    expect(error.code).toBe('QUOTE_EXPIRED');

    // Presentation alone would say "retry", but the fresh-quote requirement wins
    // in the screen flow: the quote must be re-requested before placing again.
    expect(checkoutErrorPresentation(error).recovery).toBe('retry');
    expect(requiresFreshQuote(error)).toBe(true);
  });

  it('keeps an unmapped HTTP_409 conflict replayable without demanding a fresh quote', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Concurrent modification.' }, 409));

    const error = await rejectionOf(createProductOrder(
      { quoteId: 'quote-3', cartSignature: 'sig-3' },
      'STORE_PICKUP',
      'PAY_ON_FULFILMENT',
    ));

    // normalizeApiErrorPayload synthesizes the fallback code for a body without one.
    expect(error.code).toBe('HTTP_409');
    expect(checkoutErrorPresentation(error)).toEqual({
      message: 'Concurrent modification.',
      recovery: 'retry',
    });
    expect(requiresFreshQuote(error)).toBe(false);
  });
});
