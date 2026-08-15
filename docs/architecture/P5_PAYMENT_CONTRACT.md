# Plan 5 architecture contract: provider-neutral online payments

Status: **Checkpoint A — implementation contract for architect review**

Version: **3.1**

Date: **2026-08-15**

Scope: **Plan 5 only**

## 1. Objective and authority

Plan 5 adds provider-neutral online payment to the canonical `ProductOrder`
lifecycle, implements Cashfree as the first `PaymentGateway`, reconciles provider
truth through a durable inbox, and supports policy-triggered full refunds.

The Spring Boot modular monolith and PostgreSQL remain authoritative. The
Customer app is an untrusted observer/requester. Cashfree reports payment truth,
but only the backend may validate and project that truth onto an order.

This contract is subordinate to the merged Plans 1–4 implementation and the
locked product/compliance documents. It does not authorize Plan 6 loyalty
expansion, Plan 7 recurring orders, or Plan 8 appointment runtime.

## 2. Locked invariants

1. The authenticated principal supplies Customer identity; no payment request
   accepts an authoritative `customerId` or `userId`.
2. The server derives amount and `INR` currency from the owned immutable order
   quote/order snapshot. The client cannot author money.
3. A browser/app return is advisory and never establishes success.
4. Webhook/status reconciliation owns payment truth.
5. Domain money is signed 64-bit integer paise and must be non-negative.
6. Cashfree-specific DTOs stay behind `PaymentGateway` in infrastructure.
7. `ProductOrder` remains the order lifecycle. `Payment` is not another order.
8. `PAY_ON_FULFILMENT` remains supported and preserves Plan 1–4 behavior.
9. Medicine remains `VIEW_ONLY` and cannot reach quote, order, or payment.
10. Plan 5 exposes no arbitrary Customer refund command or refund amount.
11. A captured Payment remains `CAPTURED` after a refund.
12. Cashfree credentials and provider secrets are server-side only.
13. Production fails closed when online payment is enabled without valid
    provider configuration.

## 3. Canonical vocabulary

Commerce payment methods:

- `PAY_ON_FULFILMENT`
- `ONLINE_PAYMENT`

Provider:

- `CASHFREE`

Reference types:

- `PRODUCT_ORDER`
- `APPOINTMENT` may exist for forward schema compatibility but every Plan 5
  runtime path must reject it without probing for an appointment.

Canonical `PaymentStatus`:

- `PENDING`
- `AUTHORIZED`
- `CAPTURED`
- `FAILED`
- `EXPIRED`

Canonical `RefundStatus`:

- `PENDING`
- `SUCCESS`
- `FAILED`

Canonical order payment projection:

- `PENDING_EXTERNAL_COLLECTION`
- `PENDING_ONLINE_PAYMENT`
- `PAID`
- `REFUND_PENDING`
- `REFUNDED`

Payment attempt outcomes include `SUCCESS`, `FAILED`, and `USER_DROPPED`.
Provider/session creation is not a payment attempt.

## 4. Quote and checkout contract

The existing pickup and Captain-delivery quote requests gain an optional
`paymentMethod: PAY_ON_FULFILMENT | ONLINE_PAYMENT`. For backward compatibility
with already-deployed clients, an absent field normalizes server-side to
`PAY_ON_FULFILMENT`. New clients explicitly send `PAY_ON_FULFILMENT` or
`ONLINE_PAYMENT`. The server validates and stores the normalized method in the
canonical Quote. The quote signature/fingerprint must include that normalized
method so it cannot be swapped.

Supported combinations are:

| Fulfilment | Payment |
|---|---|
| `STORE_PICKUP` | `PAY_ON_FULFILMENT` |
| `STORE_PICKUP` | `ONLINE_PAYMENT` |
| `MYPET_CAPTAIN_DELIVERY` | `PAY_ON_FULFILMENT` where currently allowed |
| `MYPET_CAPTAIN_DELIVERY` | `ONLINE_PAYMENT` |

`POST /api/v1/customer/orders` continues to accept only the canonical checkout
request (`quoteId`, `cartSignature`) and `Idempotency-Key`. It must not accept a
payment-method override. Checkout copies the server-owned method from Quote.

For pay on fulfilment, the initial projection remains
`PENDING_EXTERNAL_COLLECTION`. For online payment, checkout atomically creates:

- an order in `PLACED`;
- payment projection `PENDING_ONLINE_PAYMENT`;
- the existing inventory reservations; and
- `paymentHoldExpiresAt = serverNow + configuredHold`, with a default of 15
  minutes and no client control.

The existing five-minute quote expiry and the new fifteen-minute order payment
hold are different deadlines.

## 5. Merchant safety

The order transition transaction must lock/reload the order. Before allowing a
Merchant `PLACED -> ACCEPTED` transition:

```text
if order.paymentMethod == ONLINE_PAYMENT && order.paymentStatus != PAID
    reject ORDER_PAYMENT_REQUIRED
```

This guard is distinct from the ordinary transition matrix so the stable error
is not collapsed into `ORDER_TRANSITION_INVALID`. `PAY_ON_FULFILMENT` acceptance
must behave exactly as in Plan 4.

Cancellation or rejection of a paid order creates/reuses the one full Refund
and changes only the order payment projection. It does not rewrite Payment
provider truth.

## 6. Customer payment API

### Initiate or resume

```http
POST /api/v1/customer/payments
Authorization: Bearer <CUSTOMER session>
Idempotency-Key: <required bounded key>
Content-Type: application/json
```

The body contains only:

```json
{
  "referenceType": "PRODUCT_ORDER",
  "referenceId": "<uuid>",
  "provider": "CASHFREE"
}
```

Unknown JSON fields are rejected using the repository-wide Jackson convention.
Fields such as `userId`, `customerId`, `amount`, `amountPaise`, `currency`,
`status`, provider order IDs, and provider session IDs are forbidden.

The service derives and validates, under durable locks:

- authenticated Customer ownership;
- reference type and supported provider;
- order state and online payment method;
- non-medicine commerce eligibility already established by the canonical order;
- order total and `INR` currency;
- hold validity and payability; and
- existing canonical Payment/session state.

Idempotency is scoped to authenticated Customer plus command and retains a
request fingerprint. Reusing a key with a different fingerprint fails with
`IDEMPOTENCY_FINGERPRINT_MISMATCH`. A replay returns the same canonical Payment.
Different keys racing the same order also converge on the same Payment through
order locking and database uniqueness.

The response exposes safe provider bootstrap data only, for example
`paymentId`, `provider`, canonical `status`, `paymentSessionId`, and `expiresAt`.
It also exposes the server-derived `amountPaise` and currency for display; the
response value never becomes an input on retry.

### Read status

```http
GET /api/v1/customer/payments/{paymentId}
Authorization: Bearer <CUSTOMER session>
```

The query binds `paymentId` and authenticated Customer in the repository query.
Missing and foreign IDs both return `RESOURCE_NOT_FOUND`. The response includes
canonical Payment state, safe refund projection, amount/currency, reference ID,
and timestamps. A reference lookup may be added only as an owned projection of
the same Payment record, not as separate truth.

## 7. Payment, attempt, and history model

There is exactly one canonical Payment for
`(reference_type, reference_id, provider)`, regardless of Payment status. This is
an unconditional database unique constraint, not a partial “active payment”
index and not Java synchronization.

Non-null provider order reference is also unique for a provider. The provider
command identity is deterministic from the Payment ID and is persisted before
external I/O.

Cashfree may attach many actual payment attempts to one provider order. A
`PaymentAttempt` is created/upserted only when a real `cf_payment_id` is observed
from a verified webhook or status reconciliation. `POST /pg/orders` returning a
`payment_session_id` must never create a fake attempt.

`PaymentAttempt` has durable uniqueness on `(provider, provider_payment_id)`.
Duplicate or out-of-order delivery cannot create a second row or regress a
stored terminal attempt outcome. `FAILED` or `USER_DROPPED` attempts leave the
canonical Payment `PENDING`/`AUTHORIZED`; only a validated success captures it.

Every canonical Payment transition appends immutable `payment_history` in the
same database transaction. `CAPTURED` is monotonic and cannot regress.

## 8. Payment hold and expiry

A scheduled worker claims expired online orders using database locking suitable
for multiple replicas. For an order still `PLACED`, unpaid, and past its hold:

1. lock the order and canonical Payment, if any;
2. atomically change the order to `CANCELLED` with reason
   `ORDER_PAYMENT_EXPIRED`;
3. release each inventory reservation through the existing idempotent inventory
   command boundary exactly once;
4. mark a still-`PENDING`/`AUTHORIZED` Payment `EXPIRED`; and
5. append histories/audit with deterministic system command keys.

The worker must be safe on retry/restart. A fresh quote and order are required;
the expired order cannot be reopened.

## 9. Capture, cancellation, and race policy

Applying payment success locks the Payment and ProductOrder in one consistent
order and verifies provider reference, amount, currency, and attempt identity.

If provider success is confirmed while the order is `PLACED`, the hold is still
valid, and the order is not cancelled/rejected:

- record/upsert the `SUCCESS` attempt;
- set Payment to `CAPTURED`;
- set ProductOrder payment projection to `PAID`; and
- append histories atomically.

If provider success is confirmed after hold expiry, or after the ProductOrder is
already `CANCELLED`/`REJECTED`:

- still record Payment as `CAPTURED` because provider truth cannot be denied;
- never resurrect or accept the order;
- create/reuse exactly one durable full Refund; and
- project `REFUND_PENDING`, then `REFUNDED` only after provider confirmation.

Expiry and capture workers use database row locks, uniqueness, and deterministic
commands so either serialization yields the same valid outcome: paid live order,
or cancelled/rejected order with one full refund. No path may lose stock twice,
capture twice, or create two refunds.

## 10. Cashfree adapter and transaction boundaries

`PaymentGateway` carries typed, provider-neutral commands/results only. Cashfree
request/response DTOs, headers, API versions, order identifiers, and error
mapping stay under infrastructure. No `Map<String, Any>`, raw provider JSON, or
provider secrets cross into domain objects.

Use the established Spring HTTP client convention. Test/CI injects a fake
gateway and never calls live Cashfree.

The adapter pins its Cashfree Payments API version through server configuration,
with `CASHFREE_API_VERSION=2026-01-01` as the Plan 5 value. The same selected
version governs Create Order, payment/status reconciliation, Create/Get Refund,
and accepted webhook DTOs. Production startup rejects a missing or unsupported
version. Contract fixtures and adapter tests cover the `2026-01-01` shapes; a
future version change requires an explicit configuration, DTO, and contract-test
change rather than silently following a provider default.

### Payment initiation

TX1:

1. lock and validate the owned ProductOrder and hold;
2. find-or-create the unique Payment;
3. persist deterministic Cashfree order ID and stable provider idempotency key;
4. persist command state/fingerprint; and
5. commit.

External call, outside every PostgreSQL transaction:

- call Cashfree with the same deterministic order ID/idempotency key on every
  retry.

TX2:

- lock Payment, persist the provider order/session result and safe timestamps,
  then commit.

A timeout is `UNKNOWN`, not a canonical failure. Retry/reconciliation reuses the
same provider identity and cannot create another Payment or provider order.
Crash recovery must handle failure between any two phases.

### Refund execution

TX1 creates/reuses the one full Refund and persists deterministic provider
refund command identity, then commits. Provider HTTP runs outside the
transaction. TX2 persists the confirmed response. Timeouts and ordinary
transient/provider failures remain retryable using the same command identity.
`RefundStatus.FAILED` records the latest provider truth/error but is not an
unrecoverable workflow dead end; retry metadata/next-attempt state is separate.

Cashfree refund status normalizes as follows:

| Cashfree `refund_status` | Internal status | Required action |
|---|---|---|
| `SUCCESS` | `SUCCESS` | Confirm the full refund and project `REFUNDED` |
| `PENDING`, `ONHOLD` | `PENDING` | Keep `REFUND_PENDING` and reconcile |
| `FAILED`, `CANCELLED` | `FAILED` | Record terminal provider result; retain audit/retry policy |

A provider terminal `FAILED`/`CANCELLED` response is distinct from an HTTP or
network outcome of `UNKNOWN`. Timeout, connection loss, and 5xx never fabricate a
provider refund status. Before issuing another POST, reconciliation queries by
the same deterministic Cashfree refund identity and persists any already-created
refund. Only when that lookup establishes that no provider refund exists may the
workflow retry Create Refund with the same deterministic identity/idempotency
key.

## 11. Current Cashfree webhook contract

Cashfree Payments API documentation checked on 2026-08-15 defaults Create Order
and Create Refund to `2026-01-01`, and Payment Webhooks support a
`2026-01-01` shape. Plan 5 pins and tests that version. Its payment webhook
headers are:

- `x-webhook-signature`
- `x-webhook-timestamp`
- `x-webhook-version`
- `x-idempotency-key`

The implementation must not invent or accept `x-webhook-idempotency-key`.

Signature input is the exact timestamp string concatenated with the exact raw
request bytes/body. Compute HMAC-SHA256 with the Cashfree client secret, Base64
encode the digest, and compare decoded/validated values in constant time. Verify
required headers, configured/supported version, and signature before JSON parsing
or normalization.

`x-webhook-timestamp` is mandatory and always participates in signature
verification, but Plan 5 does not impose a hard five-minute age rejection on
Cashfree Payment webhooks. Cashfree retry/resend can deliver a valid event later;
replay safety comes from HMAC verification, `x-idempotency-key` inbox uniqueness,
`cf_payment_id` attempt uniqueness, and monotonic transitions. An additional
age/skew rule may be enabled only when the selected provider version documents
retry/resend timestamp semantics that make the rule safe; it must be explicit,
configurable, and covered by delayed-delivery tests.

Official references:

- <https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks>
- <https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order>
- <https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund>
- <https://www.cashfree.com/docs/payments/online/webhooks/signature-verification>

## 12. Durable webhook inbox

The public webhook controller performs only bounded ingest work:

1. capture exact raw body and required headers;
2. verify configured version and HMAC against the exact raw body before parsing;
3. parse and validate the verified `2026-01-01` event into a complete normalized,
   non-sensitive processing snapshot;
4. normalize delivery identity from the exact current `x-idempotency-key` and
   validated provider identifiers;
5. insert/replay that complete snapshot as a durable `RECEIVED` inbox record;
6. commit the inbox transaction; and
7. only then acknowledge with HTTP 200.

The durable normalized snapshot must be sufficient for every asynchronous
business transition without retaining or reparsing the provider payload. Persist:

- `provider` and `deliveryIdentity`;
- `webhookVersion` and `eventType`;
- `providerOrderReference`;
- `providerPaymentId` (`cf_payment_id`) when present;
- normalized `attemptStatus`;
- exact `amountPaise` and `currency`;
- `providerPaymentTime` and `providerEventTime`;
- `payloadSha256` over the exact signed bytes;
- bounded, non-sensitive provider error code/reason when applicable;
- status `RECEIVED | PROCESSING | PROCESSED | FAILED`;
- retry count, last bounded/redacted error;
- `receivedAt`, `claimStartedAt`, `leaseExpiresAt`, `processedAt`, and update
  timestamps.

Do not persist the raw payload, payment instrument/method details, Customer
details, bank data, offer metadata, surcharge metadata, gateway detail objects,
or other provider response data not required by the normalized transition.
Failure to persist/commit the normalized snapshot returns non-2xx so Cashfree
retries. A duplicate delivery whose existing inbox row is durably committed may
be acknowledged without duplicating business effects.

`processedAt` starts `NULL`. Unique `(provider, delivery_identity)` makes replay
safe. A worker atomically claims `RECEIVED`, retryable `FAILED`, and stale
`PROCESSING` rows whose lease expired. Claim ownership/lease prevents concurrent
processing; transaction rollback or deterministic reprocessing prevents partial
business effects. `FAILED` rows remain eligible under bounded retry/backoff and
operations visibility.

## 13. Reconciliation

Webhook delivery is not assumed complete or ordered. A scheduled reconciler
queries Cashfree using deterministic provider order identity for Payments that
are pending/authorized, have unknown session creation outcome, or have webhook
gaps. It feeds the same locked, idempotent canonical transition function as the
inbox worker. Restart recovery derives work exclusively from PostgreSQL state.

## 14. Refund policy

Plan 5 supports one full Refund per Payment/order. The database enforces unique
`payment_id` (and the reference association if separately stored). The amount is
copied from captured Payment, must equal the captured amount, and can never be
supplied by a Customer or exceed capture.

Authorized triggers are owning-order policy events only, including paid Customer
cancellation where currently allowed, paid Merchant rejection/cancellation, and
late capture after cancellation/rejection/hold expiry. Duplicate triggers return
the existing Refund.

Provider refund calls use a deterministic refund ID and stable idempotency key.
Refund confirmation appends immutable refund history. Payment stays `CAPTURED`;
only the ProductOrder projection moves `REFUND_PENDING -> REFUNDED`.

## 15. Money boundary

Outbound Cashfree rupees:

```kotlin
BigDecimal.valueOf(amountPaise, 2)
```

Inbound Cashfree decimal:

```kotlin
BigDecimal(value)
    .setScale(2, RoundingMode.UNNECESSARY)
    .movePointRight(2)
    .longValueExact()
```

`Double` and `Float` are forbidden for money. Before capture/refund projection,
the adapter/domain boundary verifies the deterministic provider order ID,
`data.order.order_amount`, `data.order.order_currency`, and
`data.payment.payment_currency` against canonical Payment. Cashfree-side offers,
discounts, cashback, fees, or surcharges never redefine MyPet's quoted/order
pricing and never rewrite canonical `amountPaise`.

The provider `payment_amount` is also parsed exactly and checked. Any unexpected
difference from the canonical amount enters fail-closed reconciliation/operations
handling; it must not rewrite MyPet totals or blindly mark the order paid. Scale
errors, overflow, identifier mismatch, amount mismatch, or unknown/non-`INR`
currency leave the order unpaid and produce bounded audit/alert evidence.

## 16. Migration contract

On the verified `054b439` baseline, the next migration is
`V16__customer_p5_payments_and_refunds.sql`. If main advances before Checkpoint B,
the implementation must re-evaluate and choose the next unused version.

Extend existing `mypet.commerce_quote` / `mypet.product_order`; do not duplicate
order tables. Required ProductOrder data includes online payment projection and
nullable server-owned hold expiry constrained consistently with payment method.

Create using current UUID, timestamp-with-time-zone, check-constraint, index, and
foreign-key conventions:

- `payment`
- `payment_attempt`
- `payment_history`
- `payment_webhook_inbox`
- `payment_refund`
- `payment_refund_history`

Mandatory database invariants include:

- unique Payment `(reference_type, reference_id, provider)` for all statuses;
- unique non-null provider order reference per provider;
- unique actual attempt `(provider, provider_payment_id)`;
- unique Refund by `payment_id`;
- non-negative paise and exact currency/status checks;
- nullable `processed_at` until inbox processing succeeds; and
- indexes supporting owned reads, expiry, reconciliation, inbox claims, stale
  lease recovery, and refund retry.

Flyway must migrate cleanly from V1 through current against CI H2 if required and
the repository-supported PostgreSQL/JDBC path. PostgreSQL behavior is canonical;
H2 compatibility cannot weaken production constraints.

## 17. Customer app contract

Replace the legacy `customer-payments.ts` contract. Initiation sends only
`referenceType`, `referenceId`, and `provider`, with `Idempotency-Key`. It uses
the existing `apiClient`, which already injects canonical Bearer auth; payment
helpers must not independently author `Authorization`.

Checkout offers the server-supported payment choices for pickup and Captain
delivery and displays server-returned paise/currency. After hosted checkout or
app/browser return, the UI always displays “Verifying payment…” and polls
`GET /api/v1/customer/payments/{paymentId}`.

- `CAPTURED`: success/continue to order truth.
- `PENDING` or `AUTHORIZED`: continue verifying or offer safe retry.
- `FAILED` or `EXPIRED`: failure/requote guidance from server state.
- refund display comes from canonical server projection.

Persist only the safe Payment/order identifier needed to resume status on app
restart. Never persist or collect PAN, CVV, UPI PIN, bank credentials, card
details, or provider secrets.

## 18. Privacy, security, and operations

Checkpoint D must update the data inventory, data-flow map, retention schedule,
processor register/privacy notice as applicable, threat model, and evidence
matrix for:

- Payment, attempt, provider order/payment IDs, and payload hashes;
- Refund/provider refund IDs;
- immutable payment/refund histories;
- purpose, access boundary, processor/region, retention, erasure/pseudonymization,
  incident use, and logging classification.

Financial records follow the approved legal retention schedule. Account deletion
minimizes/separates direct identifiers while retaining only authorized
pseudonymous financial evidence; backup restoration must reapply deletion
tombstones. No provider payload, instrument detail, secret, signed raw body, or
sensitive provider response body is logged or retained merely for debugging.

Production readiness also requires Cashfree processor/contract/region,
credential rotation, egress/TLS, webhook endpoint, alerting, India-log, incident,
and retention evidence. Source completion alone is not production approval.

## 19. Mandatory verification matrix

Backend tests must cover:

- server-derived Customer and amount; foreign-order IDOR; forbidden/unknown
  fields; medicine rejection; unsupported appointment;
- initiation replay; mismatched fingerprint; concurrent different keys yielding
  one Payment; unique provider reference;
- session timeout/retry and crash/restart recovery with the same identities;
- attempt `FAILED -> SUCCESS`, `USER_DROPPED -> SUCCESS`, duplicate
  `cf_payment_id`, and no fake attempt on session creation;
- duplicate/bad/missing webhook headers, exact raw-body signature, delayed valid
  delivery, configured webhook version, 2026 shape, out-of-order events, and
  `CAPTURED` non-regression;
- complete normalized snapshot committed before HTTP 200; non-2xx on inbox write
  failure; no raw/instrument/Customer payload retention; crash after `RECEIVED`;
  retryable `FAILED`; and stale `PROCESSING` reclaim;
- merchant unpaid-online rejection and pay-on-fulfilment regression;
- expiry releasing stock once; capture-versus-expiry concurrency; late capture
  producing one refund without resurrection;
- refund `SUCCESS`/`PENDING`/`ONHOLD`/`FAILED`/`CANCELLED` normalization; timeout
  or 5xx reconciliation before repeat POST; duplicate trigger; full-amount
  invariant; provider order ID and order/payment amount/currency mismatch; and
  offers/surcharges unable to rewrite MyPet pricing;
- pickup and Captain-delivery combinations; Flyway V1-current; H2 where CI
  requires it; and PostgreSQL/JDBC contracts where supported.

Customer tests must prove:

- no `userId`/amount/phone authority in initiation; canonical endpoint and
  idempotency header; auth supplied by `apiClient`;
- server amount display; browser callback cannot create success;
- pending/authorized verification, captured, failed/expired, refund, and app
  restart recovery UX; and
- `PAY_ON_FULFILMENT`, pickup, and Captain-delivery regressions.

## 20. Checkpoint boundaries

- **A:** repair branch on authoritative main and approve this contract.
- **B:** backend domain, V16 migration, fake gateway, and core tests.
- **C:** Cashfree infrastructure, webhook/reconciliation, expiry, and refunds.
- **D:** Customer integration, privacy/compliance updates, full regression, and
  draft PR.

Each checkpoint is a separate reviewed commit. No later checkpoint begins before
architect approval. The implementation agent may push and update a draft PR but
must never merge.
