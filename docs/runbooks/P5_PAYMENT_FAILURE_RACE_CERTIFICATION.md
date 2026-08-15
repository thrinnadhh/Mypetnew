# P5 Payment Failure and Race Certification

Status: Checkpoint 2 source certification procedure.

Scope: ProductOrder online-payment correctness under duplicate, failed, delayed, restarted and racing provider/order events. This checkpoint does not enable appointment payments, a second provider, production credentials, or arbitrary Customer refunds.

## 1. Objective

Checkpoint 2 proves that provider truth and ProductOrder truth remain consistent when the happy path is disturbed.

The canonical invariants are:

- one canonical Payment per `(reference_type, reference_id, provider)`;
- one durable attempt per Cashfree `cf_payment_id`;
- duplicate webhook delivery may create multiple inbox rows only when Cashfree gives different delivery identities, but business truth is applied once;
- `FAILED` and `USER_DROPPED` attempts never make the order paid;
- only validated `SUCCESS` can capture;
- `CAPTURED` is monotonic and cannot regress;
- Merchant `PLACED -> ACCEPTED` remains blocked until ProductOrder payment projection is `PAID`;
- Customer cancellation, Merchant rejection or payment-hold expiry cannot lose a late provider capture;
- late capture never resurrects the order and creates/reuses exactly one full refund intent;
- inventory release is exactly once under cancellation/expiry/late-capture races;
- reconciliation recovers provider success after webhook loss or process restart;
- refund execution uses one deterministic provider refund identity and is restart/retry safe.

## 2. Automated source gate

The primary executable certification suite is:

```text
backend/src/test/kotlin/in/mypetnew/payment/JdbcPaymentFailureRaceCertificationTest.kt
```

Run it directly:

```bash
./gradlew :backend:test \
  --tests 'in.mypetnew.payment.JdbcPaymentFailureRaceCertificationTest'
```

Then run the complete backend gate:

```bash
./gradlew :backend:check
```

The repository CI backend job remains the authoritative exact-head source gate.

## 3. Certified scenarios

### C2-01 — Duplicate delivery / duplicate provider payment

Two durable webhook deliveries carry the same provider payment ID and `SUCCESS` outcome.

Required result:

- both deliveries are durably acknowledged/processed;
- exactly one `payment_attempt` row exists for the provider payment ID;
- exactly one canonical transition to `CAPTURED` exists;
- ProductOrder becomes `PAID` once.

### C2-02 — Multiple attempts on one provider order

Apply:

```text
FAILED -> USER_DROPPED -> SUCCESS -> later FAILED attempt
```

Required result:

- every distinct provider payment ID is retained as an attempt;
- the first two outcomes leave canonical Payment `PENDING`;
- `SUCCESS` changes Payment to `CAPTURED` and ProductOrder to `PAID`;
- a later failed attempt cannot regress `CAPTURED`.

### C2-03 — Conflicting reuse of one provider payment ID

The same `cf_payment_id` is observed first as `FAILED` and later as `SUCCESS`.

Required result:

- fail closed with `PAYMENT_ATTEMPT_CONFLICT`;
- do not overwrite stored provider-attempt truth;
- do not mark ProductOrder paid from the conflicting event.

### C2-04 — Merchant acceptance gate

Before capture:

```text
PLACED + ONLINE_PAYMENT + PENDING_ONLINE_PAYMENT
```

Merchant acceptance must fail with `ORDER_PAYMENT_REQUIRED`.

After canonical provider success projects `PAID`, the same lifecycle transition may proceed normally.

### C2-05 — Late capture after payment-hold expiry

Provider success arrives after `payment_hold_expires_at` while the ProductOrder is still `PLACED`.

Required result:

- Payment records provider truth as `CAPTURED`;
- ProductOrder becomes `CANCELLED`, not resurrected;
- inventory reservation is released exactly once;
- ProductOrder projects `REFUND_PENDING`;
- exactly one full refund intent exists;
- duplicate/replayed success cannot create another release, capture transition or refund.

### C2-06 — Customer cancellation before delayed provider success

Customer cancels the still-unpaid order. Payment becomes terminal-for-order/reconcilable, stock is released, and the order stays cancelled.

If provider success is later confirmed:

- Payment still becomes `CAPTURED` because provider truth cannot be denied;
- order remains `CANCELLED`;
- exactly one refund intent is created;
- stock is not released twice.

### C2-07 — Captured cancellation and refund idempotency

A captured order is cancelled and the cancellation command is replayed.

Required result:

- one refund row only;
- one deterministic provider refund ID/idempotency key;
- refund worker submits the refund once;
- provider `SUCCESS` projects ProductOrder from `REFUND_PENDING` to `REFUNDED`;
- subsequent refund-worker iterations find no successful refund to resubmit.

### C2-08 — Webhook loss / process restart reconciliation

No webhook is inserted. A new PaymentService/JDBC persistence instance starts against the same database and provider status reports `SUCCESS`.

Required result:

- reconciliation records the provider attempt;
- Payment becomes `CAPTURED`;
- ProductOrder becomes `PAID`;
- no webhook row is fabricated.

### C2-09 — Concurrent initiation

Two initiation commands with different Customer idempotency keys race the same ProductOrder.

Required result:

- both converge on one canonical Payment ID;
- the database contains one Payment row;
- both command keys bind to that Payment;
- duplicate external Create Order calls, if the race reaches provider I/O twice, reuse the same deterministic provider order/idempotency identity and therefore remain safe.

## 4. Live sandbox adversarial matrix

Source certification is necessary but not sufficient for provider-runtime certification. After Checkpoint 1 sandbox connectivity is available, execute these cases with a physical Android staging build and Cashfree sandbox:

| Case | Provider action | Expected MyPet truth |
|---|---|---|
| success | complete sandbox payment | Payment `CAPTURED`, order `PAID` |
| failed | complete a provider-supported failed transaction | attempt `FAILED`; Payment/order remain unpaid |
| user dropped | abandon supported checkout flow | attempt `USER_DROPPED`; order remains unpaid |
| webhook resend | resend same payment webhook from provider dashboard | no duplicate attempt/capture |
| webhook unavailable | temporarily make endpoint non-200, restore, then allow retry/reconcile | eventual one canonical result |
| expiry then success | allow MyPet hold to expire, then confirm delayed provider success if sandbox tooling permits | cancelled order + one refund intent |
| captured cancellation | capture then cancel while lifecycle still permits | one refund intent; later `REFUNDED` after provider confirmation |

Do not manipulate production credentials or real-money instruments for this checkpoint.

## 5. PostgreSQL evidence queries

Set identifiers in `psql`:

```sql
\set order_id '<PRODUCT_ORDER_UUID>'
\set payment_id '<PAYMENT_UUID>'
```

### Canonical payment/order agreement

```sql
SELECT po.id AS order_id,
       po.status AS order_status,
       po.payment_method,
       po.payment_status AS order_payment_status,
       po.grand_total_paise,
       p.id AS payment_id,
       p.status AS canonical_payment_status,
       p.amount_paise,
       p.provider_order_reference,
       p.reconciliation_required,
       p.reconciliation_attempts,
       p.captured_at
FROM mypet.product_order po
JOIN mypet.payment p
  ON p.reference_type = 'PRODUCT_ORDER'
 AND p.reference_id = po.id
WHERE po.id = :'order_id'::uuid;
```

### Attempt uniqueness and ordering

```sql
SELECT provider_payment_id,
       outcome,
       payment_amount_paise,
       payment_currency,
       provider_payment_time,
       safe_error_code,
       created_at
FROM mypet.payment_attempt
WHERE payment_id = :'payment_id'::uuid
ORDER BY created_at, id;
```

No provider payment ID may appear more than once:

```sql
SELECT provider, provider_payment_id, COUNT(*)
FROM mypet.payment_attempt
WHERE payment_id = :'payment_id'::uuid
GROUP BY provider, provider_payment_id
HAVING COUNT(*) > 1;
```

Expected: zero rows.

### Webhook duplicate/retry evidence

```sql
SELECT delivery_identity,
       provider_payment_id,
       attempt_status,
       processing_status,
       retry_count,
       last_safe_error,
       received_at,
       processed_at
FROM mypet.payment_webhook_inbox
WHERE provider_order_reference = (
    SELECT provider_order_reference FROM mypet.payment WHERE id = :'payment_id'::uuid
)
ORDER BY received_at, id;
```

### Capture monotonicity

```sql
SELECT from_status, to_status, reason_code, source_identity, occurred_at
FROM mypet.payment_history
WHERE payment_id = :'payment_id'::uuid
ORDER BY occurred_at, id;
```

Required: at most one transition into `CAPTURED`, and no later transition away from `CAPTURED`.

### Refund uniqueness

```sql
SELECT id,
       payment_id,
       status,
       amount_paise,
       currency,
       provider_refund_id,
       provider_idempotency_key,
       execution_state,
       reconciliation_required,
       reconciliation_attempts,
       completed_at
FROM mypet.payment_refund
WHERE payment_id = :'payment_id'::uuid;
```

Required: zero rows for a live successful order, exactly one row when canonical policy requires a refund.

### Stock release exactly once

```sql
SELECT im.listing_id,
       im.reason,
       im.source_reference,
       COUNT(*) AS movement_count
FROM mypet.inventory_movement im
JOIN mypet.product_order_line pol ON pol.listing_id = im.listing_id
WHERE pol.order_id = :'order_id'::uuid
  AND im.reason = 'ORDER_RELEASE'
GROUP BY im.listing_id, im.reason, im.source_reference
ORDER BY im.listing_id;
```

Each order line must have at most one canonical cancellation/expiry release movement.

## 6. Pass states

Checkpoint 2 has two explicit states.

### SOURCE_CERTIFIED

All of the following are true:

- the new JDBC failure/race suite passes;
- existing Cashfree signature/config contract tests pass;
- Customer payment authority-field rejection tests pass;
- complete backend check passes;
- Customer and Merchant exact-head validation workflows remain green;
- no appointment-payment or second-provider scope was enabled.

### SANDBOX_ADVERSARIAL_CERTIFIED

`SOURCE_CERTIFIED` plus live Cashfree sandbox evidence for the applicable failure, retry/resend, reconciliation and refund cases has been captured.

If real provider credentials/public staging are unavailable, stop at `SOURCE_CERTIFIED`; do not manufacture sandbox evidence.

## 7. Out of scope

- production enablement;
- real-money transaction certification;
- appointment payments;
- second payment provider;
- partial Customer-authored refunds;
- chargeback/dispute handling;
- settlement/reconciliation accounting beyond the canonical payment/refund lifecycle;
- Plan 6 loyalty reversal execution beyond ensuring refund events remain available to that future plan.
