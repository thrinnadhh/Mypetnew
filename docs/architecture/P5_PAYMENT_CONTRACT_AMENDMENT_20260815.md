# Plan 5 payment contract amendment — 2026-08-15

Status: **Authoritative implementation amendment to P5_PAYMENT_CONTRACT.md v3.2**

Scope: **Checkpoint B foundation only**

## Why this amendment exists

Implementation review of the interrupted Checkpoint-B recovery exposed two durability gaps that were implicit but not explicit enough in the v3.2 contract. This amendment tightens the contract before broader Cashfree runtime work continues.

## 1. Durable initiation-command mapping

The invariant "different idempotency keys racing the same order converge on one canonical Payment" also requires every accepted Customer command key to remain durably replayable after the order later changes state or its payment hold expires.

Therefore a single `initiation_idempotency_key` stored on `payment` is insufficient. Plan 5 requires a separate durable mapping:

```text
payment_initiation_command
(customer_id, idempotency_key) -> payment_id + request_fingerprint
```

Required constraints and behavior:

- primary/unique key on `(customer_id, idempotency_key)`;
- each accepted key stores its request fingerprint and canonical `payment_id`;
- same key + same fingerprint returns the same Payment without re-validating later order payability;
- same key + different fingerprint fails `IDEMPOTENCY_FINGERPRINT_MISMATCH`;
- different keys racing the same `(reference_type, reference_id, provider)` converge on one Payment and each key is persisted;
- ProductOrder is locked before Payment lookup/create so database serialization, not JVM synchronization, owns correctness.

## 2. Ambiguous provider transport is UNKNOWN

Create-Order transport failures that do not prove provider rejection are never canonical payment failure.

Timeout, connection reset, dropped response, and equivalent ambiguous transport outcomes must become a typed transport-ambiguity result/exception. The application layer must durably project:

```text
provider_command_state = UNKNOWN
reconciliation_required = true
```

using the already-persisted deterministic provider order identity and provider idempotency key.

The next attempt must reconcile/reuse that identity; it must not create a second provider order.

Programming/configuration errors are not silently converted to UNKNOWN. Only explicitly classified ambiguous transport failures receive this treatment.

## 3. Migration consequence

Because V16 has not been merged to `main`, the draft V16 migration may be corrected in-place before merge to add `payment_initiation_command` and remove the misleading single-command columns from `payment`.

## 4. Verification required before Checkpoint C

Checkpoint B is not certifiable until exact-head CI proves:

- legacy missing `paymentMethod` still normalizes to `PAY_ON_FULFILMENT`;
- online quote fingerprint includes normalized payment method;
- online checkout receives a server-owned hold;
- unpaid online order cannot be Merchant-accepted;
- server derives Customer and amount;
- foreign/nonexistent references fail closed;
- same-key replay is stable;
- same-key/different-fingerprint fails;
- different keys converge on one canonical Payment and each replay remains stable;
- ambiguous provider transport persists `UNKNOWN` + reconciliation required;
- PostgreSQL/Flyway migration remains clean.

All remaining v3.2 Plan-5 invariants stay unchanged.
