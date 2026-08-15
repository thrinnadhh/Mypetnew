# P5 Cashfree provider version decision

Status: ACTIVE — supersedes earlier P5 references that pinned `2026-01-01`.

Decision date: 2026-08-15

## Decision

MyPet P5 pins both Cashfree Payment Gateway REST requests and payment webhooks to `2025-01-01` for the current sandbox/live certification cycle.

The operational settings are therefore:

```text
CASHFREE_API_VERSION=2025-01-01
CASHFREE_WEBHOOK_VERSION=2025-01-01
CASHFREE_BASE_URL=https://sandbox.cashfree.com/pg   # sandbox certification
```

Production continues to use `https://api.cashfree.com/pg` only after the production gate is approved.

## Why this overrides the earlier 2026 pin

During P5 Checkpoint 1, provider documentation appeared inconsistent and the repository was temporarily pinned to `2026-01-01`. Re-verification immediately before Checkpoint 3 found the current official Cashfree Payment Gateway reference identifies `2025-01-01` as v5/latest, Create Order and Create Refund default to `2025-01-01`, and the current webhook configuration/reference exposes `2025-01-01`.

A live provider-certification gate must follow the provider contract that is actually documented/configurable at execution time. Keeping the repository fail-closed on an unsupported or unavailable version would make the sandbox gate invalid.

## Source-of-truth references

- Cashfree Payment Gateway overview: https://www.cashfree.com/docs/api-reference/payments/latest/overview
- Create Order: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
- Create Refund: https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create
- Payment Webhooks: https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks
- Webhook configuration: https://www.cashfree.com/docs/payments/online/webhooks/configure

## Invariants

- REST and webhook versions remain separate configuration values even while they share the same selected version.
- The backend fails startup/configuration validation for an unsupported version.
- Version changes require an explicit source change, contract-test change, deployment change, dashboard webhook migration, and fresh sandbox evidence.
- Do not silently follow a Cashfree default or change versions solely from a stale search snippet.
- Before production enablement, re-check the Cashfree dashboard and official references because provider rollouts can be account/region dependent.

## Documentation precedence

Where an older P5 document says `2026-01-01`, this decision record is authoritative for Checkpoint 3 and later certification work until another explicit provider-version decision replaces it.
