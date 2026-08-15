# P5 Cashfree Sandbox Certification Runbook

Status: Checkpoint 1 runtime certification procedure.

Scope: ProductOrder `ONLINE_PAYMENT` through Cashfree sandbox only. Appointment payment remains fail-closed until Plan 8. This runbook does not approve production use and does not replace the P5 refund/adversarial certification checkpoints.

## 1. Provider version alignment

For the live sandbox gate, MyPet uses Cashfree Payment Gateway API version `2025-01-01` and payment-webhook version `2025-01-01`.

The earlier Plan 5 design draft pinned `2026-01-01`. That pin is superseded for runtime integration because the current Cashfree Payment Gateway API/webhook documentation exposes `2025-01-01` as the supported latest version. Runtime code must fail closed if a different version is configured.

Approved Payment Gateway base URLs:

- sandbox: `https://sandbox.cashfree.com/pg`
- production: `https://api.cashfree.com/pg`

Checkpoint 1 MUST use sandbox.

## 2. Required deployment topology

```text
Physical Customer Android development/staging build
        |
        | HTTPS
        v
Public MyPet staging backend
        |
        +--> PostgreSQL/Supabase
        |
        +--> Cashfree sandbox Create Order / payment reconciliation
        ^
        |
Cashfree sandbox payment webhook
POST /api/v1/webhooks/cashfree/payments
```

Do not use a LAN address, Android emulator loopback, localhost, or HTTP callback for certification.

## 3. Required environment

Set these in the deployed backend secret/configuration store. Do not commit real values.

```bash
export CASHFREE_ENABLED=true
export CASHFREE_CLIENT_ID='<sandbox-client-id>'
export CASHFREE_CLIENT_SECRET='<sandbox-client-secret>'
export CASHFREE_API_VERSION='2025-01-01'
export CASHFREE_WEBHOOK_VERSION='2025-01-01'
export CASHFREE_BASE_URL='https://sandbox.cashfree.com/pg'
export CASHFREE_RETURN_URL='https://<public-return-host>/payments/cashfree/return'
export CASHFREE_NOTIFY_URL='https://<public-api-host>/api/v1/webhooks/cashfree/payments'

export DATABASE_URL='jdbc:postgresql://<host>:5432/<database>?sslmode=require'
export DATABASE_USERNAME='<runtime-user>'
export DATABASE_PASSWORD='<runtime-secret>'
```

Customer staging build:

```bash
export EXPO_PUBLIC_APP_ENV=staging
export EXPO_PUBLIC_API_BASE_URL='https://<public-api-host>'
```

`CASHFREE_CLIENT_SECRET` is server-only. It must never use an `EXPO_PUBLIC_` variable and must never be present in an EAS client build.

## 4. Preflight gate

Load the environment in the shell and run:

```bash
bash scripts/p5-cashfree-sandbox-preflight.sh
```

After the backend is deployed publicly, rerun with network probing enabled:

```bash
P5_PROBE_PUBLIC_ENDPOINT=1 bash scripts/p5-cashfree-sandbox-preflight.sh
```

Expected result:

- `/actuator/health` returns HTTP 200;
- the public webhook route is reachable;
- an unsigned webhook probe is rejected with 4xx;
- an unsigned webhook MUST NOT return HTTP 200;
- no live Cashfree charge is created by the preflight script.

## 5. Cashfree dashboard webhook

Configure the sandbox payment webhook to the exact value of `CASHFREE_NOTIFY_URL`:

```text
https://<public-api-host>/api/v1/webhooks/cashfree/payments
```

Select payment success, failed, and user-dropped events for webhook version `2025-01-01`.

MyPet verifies the exact raw body using `x-webhook-timestamp` plus the raw payload and HMAC-SHA256 with the Cashfree client secret. Required headers include `x-webhook-signature`, `x-webhook-timestamp`, `x-webhook-version`, and the provider delivery identity used by the durable inbox contract.

Do not put Basic auth credentials, bearer tokens, query secrets, or provider secrets in the webhook URL.

## 6. Physical Android sandbox transaction

Use an EAS development/staging build containing the Cashfree native SDK. Expo Go is not a certification target for this flow.

Certification sequence:

1. Sign in as a real test Customer account.
2. Add one commerce product from one Merchant to cart.
3. Choose either Store Pickup or MyPet Captain Delivery.
4. Choose `ONLINE_PAYMENT`.
5. Obtain a fresh server quote.
6. Submit checkout. Confirm the server-created ProductOrder has `ONLINE_PAYMENT` and a payment hold.
7. Initiate payment through `POST /api/v1/customer/payments`.
8. Confirm the server returns only safe Cashfree bootstrap data and a payment session identifier.
9. Open Cashfree using the native SDK.
10. Complete a Cashfree sandbox payment using a provider-supported sandbox instrument.
11. Treat the SDK/browser callback only as a signal to re-check server state; it is not payment authority.
12. Wait for Cashfree webhook processing and/or provider reconciliation.
13. Confirm the canonical MyPet Payment becomes `CAPTURED`.
14. Confirm ProductOrder payment projection becomes paid/captured according to the existing order contract.
15. Confirm the Customer UI reaches success only after the server reports canonical success.

Record the test order ID, MyPet payment ID, Cashfree provider order reference, Cashfree payment ID, UTC timestamps, and non-sensitive screenshots/log IDs. Do not record PAN, CVV, UPI PIN, bank credentials, client secret, or full provider payloads.

## 7. PostgreSQL evidence queries

Set the two identifiers from the sandbox transaction in `psql`:

```sql
\set order_id '<PRODUCT_ORDER_UUID>'
\set payment_id '<PAYMENT_UUID>'
```

### 7.1 Product order

```sql
SELECT id,
       customer_id,
       outlet_id,
       status,
       payment_method,
       payment_status,
       payment_hold_expires_at,
       grand_total_paise,
       created_at,
       updated_at
FROM mypet.product_order
WHERE id = :'order_id'::uuid;
```

Required evidence:

- one row only;
- `payment_method = 'ONLINE_PAYMENT'`;
- amount matches the server quote/payment;
- the final payment projection is the canonical paid/captured projection expected by ProductOrder after provider success.

### 7.2 Payment

```sql
SELECT id,
       reference_type,
       reference_id,
       customer_id,
       provider,
       status,
       amount_paise,
       currency,
       provider_order_reference,
       provider_command_state,
       reconciliation_required,
       reconciliation_attempts,
       captured_at,
       expires_at,
       created_at,
       updated_at
FROM mypet.payment
WHERE id = :'payment_id'::uuid;
```

Required evidence:

- `reference_type = 'PRODUCT_ORDER'`;
- `reference_id = order_id`;
- `provider = 'CASHFREE'`;
- exact paise amount and `INR` match ProductOrder;
- terminal success is `CAPTURED`;
- provider secret/payment-instrument details are absent.

### 7.3 Provider payment attempt

```sql
SELECT payment_id,
       provider,
       provider_payment_id,
       outcome,
       payment_amount_paise,
       payment_currency,
       provider_payment_time,
       safe_error_code,
       created_at,
       updated_at
FROM mypet.payment_attempt
WHERE payment_id = :'payment_id'::uuid
ORDER BY created_at;
```

Required evidence for the success case:

- a Cashfree attempt exists;
- `outcome = 'SUCCESS'`;
- provider payment ID is populated once;
- amount/currency exactly match canonical Payment.

### 7.4 Payment history

```sql
SELECT payment_id,
       from_status,
       to_status,
       reason_code,
       source_identity,
       occurred_at
FROM mypet.payment_history
WHERE payment_id = :'payment_id'::uuid
ORDER BY occurred_at, id;
```

Required evidence:

- history is append-only;
- a deterministic provider/webhook/reconciliation source explains the transition to `CAPTURED`;
- no transition is created solely from the Customer SDK callback.

### 7.5 Durable webhook inbox

```sql
SELECT id,
       provider,
       delivery_identity,
       webhook_version,
       event_type,
       provider_order_reference,
       provider_payment_id,
       attempt_status,
       order_amount_paise,
       order_currency,
       payment_amount_paise,
       payment_currency,
       payload_sha256,
       processing_status,
       retry_count,
       received_at,
       processed_at
FROM mypet.payment_webhook_inbox
WHERE provider_order_reference = (
    SELECT provider_order_reference
    FROM mypet.payment
    WHERE id = :'payment_id'::uuid
)
ORDER BY received_at;
```

Required evidence:

- the verified delivery is durable;
- `webhook_version = '2025-01-01'`;
- normalized amount/currency match canonical Payment;
- payload hash is present, raw payload is not stored;
- successful processing ends `PROCESSED` with `processed_at` populated.

## 8. Cross-table invariant query

Run this single reconciliation view for the transaction:

```sql
SELECT po.id AS order_id,
       po.payment_method AS order_payment_method,
       po.payment_status AS order_payment_status,
       po.grand_total_paise AS order_amount_paise,
       p.id AS payment_id,
       p.status AS payment_status,
       p.amount_paise AS payment_amount_paise,
       p.currency,
       p.provider,
       p.provider_order_reference,
       COUNT(DISTINCT pa.id) AS attempt_count,
       COUNT(DISTINCT ph.id) AS history_count,
       COUNT(DISTINCT wi.id) AS webhook_count
FROM mypet.product_order po
JOIN mypet.payment p
  ON p.reference_type = 'PRODUCT_ORDER'
 AND p.reference_id = po.id
LEFT JOIN mypet.payment_attempt pa ON pa.payment_id = p.id
LEFT JOIN mypet.payment_history ph ON ph.payment_id = p.id
LEFT JOIN mypet.payment_webhook_inbox wi
  ON wi.provider = p.provider
 AND wi.provider_order_reference = p.provider_order_reference
WHERE po.id = :'order_id'::uuid
GROUP BY po.id,
         po.payment_method,
         po.payment_status,
         po.grand_total_paise,
         p.id,
         p.status,
         p.amount_paise,
         p.currency,
         p.provider,
         p.provider_order_reference;
```

The order and Payment amounts must match exactly. A successful certification must show one canonical Payment and at least one provider truth path (verified webhook and/or reconciliation) that explains `CAPTURED`.

## 9. Checkpoint 1 pass criteria

Checkpoint 1 is **SANDBOX_RUNTIME_CERTIFIED** only when all are true:

- source CI is green on the exact commit under certification;
- deployed backend starts with `CASHFREE_ENABLED=true` and the sandbox runtime guard passes;
- public HTTPS health endpoint is reachable;
- unsigned webhook is rejected;
- Cashfree dashboard sends the configured `2025-01-01` payment webhook to the public endpoint;
- a physical Android staging build completes a sandbox ProductOrder payment;
- Customer callback alone cannot mark success;
- canonical Payment reaches `CAPTURED` from server/provider truth;
- ProductOrder payment projection agrees with Payment;
- `product_order`, `payment`, `payment_attempt`, `payment_history`, and `payment_webhook_inbox` evidence has been captured;
- no secret or payment-instrument data appears in logs/evidence.

If any item is missing, the status remains **SOURCE_READY_FOR_SANDBOX**, not certified.

## 10. Explicitly out of scope for Checkpoint 1

- production Cashfree credentials;
- production enablement;
- appointment payment;
- second payment provider;
- full failure/race matrix;
- refund sandbox certification;
- commercial/DPA/processor-region evidence.

Those remain subsequent P5 gates.
