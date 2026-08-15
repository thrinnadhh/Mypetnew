# P5 Cashfree Sandbox Certification Runbook

Status: Checkpoint 1 runtime-readiness procedure. Checkpoint 3 now owns the full live sandbox/adversarial certification.

Scope: ProductOrder `ONLINE_PAYMENT` through Cashfree sandbox only. Appointment payment remains fail-closed until Plan 8.

## Provider contract

The active provider-version decision is `docs/architecture/P5_CASHFREE_PROVIDER_VERSION_DECISION.md`.

Current certification values:

```text
CASHFREE_API_VERSION=2025-01-01
CASHFREE_WEBHOOK_VERSION=2025-01-01
CASHFREE_BASE_URL=https://sandbox.cashfree.com/pg
```

Older P5 references to `2026-01-01` are superseded by the active provider-version decision.

## Required deployment topology

```text
Physical Customer Android development/staging build
        |
        | HTTPS
        v
Public MyPet staging backend
        |
        +--> PostgreSQL/Supabase
        |
        +--> Cashfree sandbox
        ^
        |
Cashfree signed payment webhook
POST /api/v1/webhooks/cashfree/payments
```

Do not use LAN HTTP, localhost, emulator loopback, or Expo Go as the certification target.

## Required environment

Store real values in the deployed backend secret/configuration store only:

```bash
CASHFREE_ENABLED=true
CASHFREE_CLIENT_ID='<sandbox-client-id>'
CASHFREE_CLIENT_SECRET='<sandbox-client-secret>'
CASHFREE_API_VERSION='2025-01-01'
CASHFREE_WEBHOOK_VERSION='2025-01-01'
CASHFREE_BASE_URL='https://sandbox.cashfree.com/pg'
CASHFREE_RETURN_URL='https://<public-return-host>/payments/cashfree/return'
CASHFREE_NOTIFY_URL='https://<public-api-host>/api/v1/webhooks/cashfree/payments'

EXPO_PUBLIC_APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL='https://<public-api-host>'
```

`CASHFREE_CLIENT_SECRET` is server-only and must never appear in `EXPO_PUBLIC_*`, EAS client configuration, logs, screenshots, or committed files.

## Preflight

Run:

```bash
bash scripts/p5-cashfree-sandbox-preflight.sh
```

After public deployment:

```bash
P5_PROBE_PUBLIC_ENDPOINT=1 bash scripts/p5-cashfree-sandbox-preflight.sh
```

Expected:

- sandbox version/base URL contract passes;
- public backend health returns HTTP 200;
- webhook route is reachable;
- an unsigned webhook returns 4xx, never 200;
- the script creates no payment or refund.

## Dashboard webhook

Configure the sandbox Payment Gateway webhook to:

```text
https://<public-api-host>/api/v1/webhooks/cashfree/payments
```

Select webhook version `2025-01-01` and enable payment success, failed, and user-dropped events.

MyPet verifies the exact raw payload using `x-webhook-timestamp` and `x-webhook-signature`, validates `x-webhook-version`, and uses `x-idempotency-key` as the durable delivery identity. Raw webhook payloads are not retained after normalization.

## Physical Android happy-path gate

1. Sign in with a test Customer account.
2. Add one COMMERCE product from one merchant.
3. Choose pickup or Captain delivery.
4. Select `ONLINE_PAYMENT`.
5. Submit canonical checkout.
6. Initiate `POST /api/v1/customer/payments`.
7. Open Cashfree through the native SDK.
8. Complete a sandbox payment.
9. Treat the SDK callback only as a signal to refresh server state.
10. Verify canonical Payment reaches `CAPTURED` from provider/server truth.
11. Verify ProductOrder payment projection reaches `PAID`.

Record only non-sensitive order/payment/provider references and timestamps. Never record PAN, CVV, UPI PIN, bank credentials, access tokens, client secret, or raw webhook bodies.

## Checkpoint 1 status

Checkpoint 1 is `SANDBOX_RUNTIME_CERTIFIED` only after the public backend, dashboard webhook, physical Android sandbox payment, canonical `CAPTURED`/`PAID` state, and sanitized database evidence are actually observed.

Until then the correct status remains `SOURCE_READY_FOR_SANDBOX`.

For duplicate/resend, failed/user-dropped, reconciliation, refund, and late-capture certification, use:

```text
docs/runbooks/P5_CHECKPOINT3_LIVE_SANDBOX_CERTIFICATION.md
scripts/p5-cashfree-checkpoint3-evidence.sh
```
