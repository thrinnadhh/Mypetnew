# P5 Checkpoint 3 — Cashfree live sandbox certification

Status: SOURCE_READY_FOR_LIVE_SANDBOX

Scope: execute the already source-certified ProductOrder payment/refund lifecycle against the real Cashfree sandbox and capture non-sensitive evidence. This checkpoint does not approve production credentials, appointment payments, a second provider, chargebacks, or Plan 6.

## 1. Provider contract gate

Checkpoint 3 uses:

```text
CASHFREE_API_VERSION=2025-01-01
CASHFREE_WEBHOOK_VERSION=2025-01-01
CASHFREE_BASE_URL=https://sandbox.cashfree.com/pg
```

The version decision is documented in `docs/architecture/P5_CASHFREE_PROVIDER_VERSION_DECISION.md` and supersedes older P5 references to `2026-01-01`.

Before every production enablement, re-check the Cashfree dashboard and official documentation. Do not silently change the version because a provider rollout may be account/region dependent.

## 2. Required topology

```text
Physical Android staging/development build
        |
        | HTTPS
        v
Public MyPet staging backend
        |                  ^
        |                  |
        +--> PostgreSQL    | Cashfree signed webhooks
        |
        +--> Cashfree sandbox REST APIs
```

Certification requires a public HTTPS backend. LAN HTTP, localhost, emulator loopback, and Expo Go are not certification targets.

## 3. Secret and environment requirements

Real sandbox values belong in the deployment secret store only. Do not paste the Cashfree client secret into issue comments, PR descriptions, chat, screenshots, or committed files.

Required server values:

```bash
CASHFREE_ENABLED=true
CASHFREE_CLIENT_ID='<sandbox-client-id>'
CASHFREE_CLIENT_SECRET='<sandbox-client-secret>'
CASHFREE_API_VERSION='2025-01-01'
CASHFREE_WEBHOOK_VERSION='2025-01-01'
CASHFREE_BASE_URL='https://sandbox.cashfree.com/pg'
CASHFREE_RETURN_URL='https://<public-return-host>/payments/cashfree/return'
CASHFREE_NOTIFY_URL='https://<public-api-host>/api/v1/webhooks/cashfree/payments'
```

Customer build:

```bash
EXPO_PUBLIC_APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL='https://<public-api-host>'
```

Never expose the Cashfree secret through `EXPO_PUBLIC_*`.

## 4. Preflight

Run:

```bash
bash scripts/p5-cashfree-sandbox-preflight.sh
```

After the public staging backend is deployed:

```bash
P5_PROBE_PUBLIC_ENDPOINT=1 bash scripts/p5-cashfree-sandbox-preflight.sh
```

Required:

- Cashfree enabled only for this sandbox/staging runtime;
- REST and webhook versions exactly `2025-01-01`;
- sandbox base URL exact;
- public HTTPS return/notify URLs;
- health endpoint returns HTTP 200;
- unsigned webhook is rejected with 4xx;
- unsigned webhook never returns 200.

## 5. Cashfree dashboard configuration

In the sandbox Merchant Dashboard, configure the exact webhook URL:

```text
https://<public-api-host>/api/v1/webhooks/cashfree/payments
```

Select the `2025-01-01` webhook version and enable payment success, payment failed, and user-dropped events.

MyPet requires the signed raw payload and these headers:

- `x-webhook-signature`
- `x-webhook-timestamp`
- `x-webhook-version`
- `x-idempotency-key`

MyPet verifies HMAC before parsing and stores only a normalized snapshot plus payload SHA-256, never the raw body.

## 6. Checkpoint 3 scenario matrix

### C3-01 — Successful ProductOrder payment

1. Sign in on a physical Android staging build.
2. Add one COMMERCE product from one merchant.
3. Choose pickup or Captain delivery.
4. Select `ONLINE_PAYMENT`.
5. Submit canonical checkout and initiate payment.
6. Complete the Cashfree sandbox transaction.
7. Treat the SDK callback only as a signal to refresh server state.
8. Verify canonical Payment becomes `CAPTURED` only after server/provider truth.
9. Verify ProductOrder payment projection becomes `PAID`.

Required evidence:

- one canonical Payment;
- exact order/payment paise amount match;
- one `SUCCESS` provider attempt;
- at most one transition into `CAPTURED`;
- at least one verified `2025-01-01` webhook delivery for this scenario;
- Customer UI does not declare success from callback alone.

### C3-02 — Failed attempt

Create a provider-supported sandbox failed payment attempt.

Required:

- a distinct `FAILED` `cf_payment_id` attempt is retained;
- Payment remains non-captured;
- ProductOrder remains unpaid;
- Merchant cannot accept the unpaid online order.

### C3-03 — User-dropped attempt

Start the Cashfree flow and abandon it using a provider-supported sandbox path.

Required:

- `USER_DROPPED` attempt is retained when Cashfree emits it;
- canonical Payment remains non-captured;
- ProductOrder remains unpaid;
- a later retry may succeed without creating a second canonical Payment.

### C3-04 — Duplicate/resend webhook

Use the Cashfree dashboard resend/retry facility for the successful payment event.

Required:

- duplicate provider truth does not create a duplicate `payment_attempt` for the same `cf_payment_id`;
- at most one Payment transition to `CAPTURED` exists;
- order remains `PAID`;
- durable inbox reflects verified delivery/retry behavior without replaying business truth.

### C3-05 — Webhook outage and reconciliation

In a controlled staging-only exercise, make the webhook endpoint temporarily return non-2xx or be unavailable, then restore it. Do not alter production infrastructure.

Required:

- Cashfree retry and/or MyPet provider reconciliation eventually converges to one canonical result;
- no callback-authored payment success appears;
- process restart does not lose the pending truth;
- no duplicate capture is created.

### C3-06 — Captured cancellation and full refund

After a successful capture, cancel/reject only through a lifecycle path that is valid for the test order.

Required:

- one durable full refund intent;
- deterministic Cashfree refund identity/idempotency key reused on retry;
- Payment remains `CAPTURED`;
- order projection becomes `REFUND_PENDING` and later `REFUNDED` only after provider refund confirmation;
- exactly one successful refund row exists at final certification.

Cashfree's current Create Refund documentation permits sandbox refund simulation using documented `refund_note` values. MyPet does not add a Customer-controlled refund note or weaken production refund semantics for this test. If the ordinary application-triggered sandbox refund cannot reach a deterministic provider result, record that provider limitation and do not mark C3-06 certified until the integration can be exercised safely.

### C3-07 — Late capture after hold expiry

Where Cashfree sandbox tooling permits a delayed success:

1. create an online-payment order;
2. let MyPet's payment hold expire so the order becomes `CANCELLED` and stock releases;
3. then allow/confirm provider success.

Required:

- provider truth is still recorded as Payment `CAPTURED`;
- ProductOrder stays `CANCELLED`;
- stock release occurs at most once per canonical release identity;
- one full refund intent exists;
- order payment projection is `REFUND_PENDING` or final `REFUNDED`.

If Cashfree sandbox cannot produce this timing deterministically, retain Checkpoint 2's source certification for the race and explicitly mark this live subcase `PROVIDER_SIMULATION_UNAVAILABLE`; do not invent evidence.

## 7. Automated database evidence harness

The repository contains:

```text
scripts/p5-cashfree-checkpoint3-evidence.sh
```

It is read-only. It collects canonical Payment/Order, attempts, history, webhook inbox, refunds, and inventory-release facts. It does not collect Cashfree credentials, PAN, CVV, UPI PIN, bank credentials, or raw webhook bodies.

Configure PostgreSQL access using standard `PG*` variables, preferably `.pgpass` or a temporary environment secret:

```bash
export PGHOST='<db-host>'
export PGPORT='5432'
export PGDATABASE='<db-name>'
export PGUSER='<read-only-evidence-user>'
export PGSSLMODE='require'
# PGPASSWORD may be supplied by the secret store; never commit it.
```

For each scenario:

```bash
export P5_ORDER_ID='<product-order-uuid>'
export P5_PAYMENT_ID='<payment-uuid>'
export P5_EXPECTED_SCENARIO='success'

bash scripts/p5-cashfree-checkpoint3-evidence.sh
```

Allowed scenario values:

```text
success
failed
user_dropped
refund
late_capture
```

The script exits non-zero when a required database invariant fails and writes sanitized evidence files to a temporary directory unless `P5_EVIDENCE_DIR` is explicitly set.

Run it once per corresponding real sandbox order. Do not reuse a success-order ID to pretend a failed/user-dropped case occurred.

## 8. Required evidence package

For each scenario retain only non-sensitive artifacts:

- test scenario name;
- UTC execution time;
- MyPet ProductOrder UUID;
- MyPet Payment UUID;
- provider order reference;
- `cf_payment_id` where applicable;
- refund ID where applicable;
- sanitized DB evidence generated by the harness;
- Cashfree dashboard event/log reference or screenshot with secrets/instrument data redacted;
- Android screen recording/screenshot showing application state only, with personal data minimized;
- backend trace/log ID where useful, with secrets redacted.

Never retain:

- client secret;
- PAN/CVV;
- UPI PIN;
- bank credentials;
- full raw webhook payload;
- authentication tokens;
- full Customer phone/address unless required by a separate approved test artifact.

## 9. Pass states

### CHECKPOINT3_SOURCE_READY

All are true:

- current Cashfree version contract is corrected to `2025-01-01`;
- backend config and adapter fail closed on unsupported versions;
- preflight enforces the same version and public endpoint constraints;
- contract tests cover request/webhook version enforcement;
- Checkpoint 2 source/race suite remains green;
- evidence harness is present;
- exact-head backend, Customer, and Merchant CI are green.

### CHECKPOINT3_LIVE_SANDBOX_CERTIFIED

`CHECKPOINT3_SOURCE_READY` plus real sandbox evidence for:

- C3-01 success;
- C3-02 failed;
- C3-03 user dropped where Cashfree emits the event;
- C3-04 duplicate/resend;
- C3-05 webhook retry/reconciliation;
- C3-06 captured cancellation/refund;
- C3-07 late capture if provider sandbox timing can be exercised, otherwise explicitly recorded as provider-simulation unavailable with Checkpoint 2 source evidence retained.

The status must remain `CHECKPOINT3_SOURCE_READY` until the live provider/device work is actually executed.

## 10. Production boundary

Checkpoint 3 does not authorize production.

Production still requires at minimum:

- production Cashfree account/credentials provisioned through an approved secret manager;
- credential rotation owner/procedure;
- public TLS endpoint and monitoring;
- provider terms/privacy/subprocessor/data-location evidence;
- retention decision for payment/refund metadata;
- alerting for webhook/reconciliation/refund failures;
- incident procedure;
- final production transaction/refund smoke under an approved low-risk procedure.

Plan 6 must not be started or merged as a consequence of this checkpoint without an explicit instruction to begin Plan 6.
