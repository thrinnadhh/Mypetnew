# P5 Cashfree provider-version override

Status: **normative runtime override**, 2026-08-15.

This file supersedes every Plan 5 architecture/compliance statement that pins Cashfree Payment Gateway API or payment-webhook version `2026-01-01`.

## Effective contract

Until a later explicit provider-version migration is reviewed and tested:

```text
CASHFREE_API_VERSION=2025-01-01
CASHFREE_WEBHOOK_VERSION=2025-01-01
```

Approved Payment Gateway endpoints are:

```text
sandbox    https://sandbox.cashfree.com/pg
production https://api.cashfree.com/pg
```

Checkpoint 1 certification MUST use the sandbox endpoint.

## Why this override exists

The P5 source implementation originally used a future-dated `2026-01-01` provider contract. Verification against the current Cashfree Payment Gateway reference on 2026-08-15 showed the published latest Payment Gateway API as `2025-01-01`; the current payment-webhook reference likewise documents `2025-01-01` rather than `2026-01-01`.

A provider version is an external wire contract, not an internal release label. MyPet therefore must send and accept only a provider version that Cashfree actually documents and exposes in the target environment.

## Runtime requirements

`CashfreeProperties` is authoritative for startup validation and must:

1. reject any API version other than `2025-01-01`;
2. reject any webhook version other than `2025-01-01`;
3. permit only the approved Cashfree Payment Gateway base URLs;
4. require public absolute HTTPS `return_url` and `notify_url` when online payment is enabled;
5. require the notify URL path to be exactly `/api/v1/webhooks/cashfree/payments` with no query or fragment;
6. keep the client ID and client secret server-side and redacted from configuration logging.

## Webhook requirements

The existing P5 webhook invariants remain unchanged except for the version literal:

- verify the signature over the exact raw body and `x-webhook-timestamp` before parsing;
- require `x-webhook-signature`, `x-webhook-timestamp`, `x-webhook-version`, and the provider delivery identity used by the durable inbox;
- normalize only verified financial/event facts into `payment_webhook_inbox`;
- acknowledge a first delivery only after the durable inbox insert commits;
- never treat the Customer SDK/browser callback as payment success authority.

Any future move away from `2025-01-01` requires an explicit source change, fixtures for the new request/response and webhook shapes, exact-head CI, and a fresh sandbox certification. Do not silently follow a provider default.
