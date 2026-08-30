# M9 Order and POS Transaction Hardening

## Scope

M9 closes the transaction races between catalog price/lifecycle state, online order reservation, and Merchant POS completion. It does not introduce a new inventory authority, a new pricing store, or offline POS finalization.

## Canonical lock order

Production checkout and POS completion now enter their existing PostgreSQL transaction and acquire shared row locks on every requested `mypet.catalog_listing`, ordered by listing UUID. Only after those rows are locked may the workflow snapshot price/name and mutate inventory.

The effective order is:

1. idempotency replay check;
2. transaction start;
3. deterministic catalog `FOR SHARE` locks;
4. transaction-time listing/outlet/commerce validation;
5. order/POS snapshot insertion;
6. canonical inventory reservation or sale, which locks `inventory_balance`;
7. reservation / loyalty / receipt effects;
8. commit.

Catalog UPDATE/DELETE conflicts with the shared commerce lock. Two commerce transactions may share catalog locks and are serialized only when they contend on canonical inventory. This avoids unnecessarily serializing independent reads while giving price updates a single database-ordered outcome.

## Checkout semantics

A quote remains a customer contract. At checkout, every quoted listing is reloaded under the transaction lock. Organization, outlet, active state, commerce mode, and unit price must still match. A committed price or lifecycle change before the lock produces `QUOTE_STALE` and no order or reservation residue. If checkout owns the lock first, the catalog update waits until the checkout transaction commits.

## POS semantics

Caller-supplied price/name fields are never authoritative. POS locks the current listings at completion and persists the locked server name and selling price. A catalog update committed before the lock is therefore reflected in the receipt; an update that loses the lock waits until the sale commits.

POS idempotency fingerprints represent client intent (merchant/outlet, customer association identity, quantities, payment declaration, cashier) and deliberately exclude server-owned unit prices. This lets an unknown-outcome retry return the original committed receipt after a later catalog reprice. Different quantities, payment declaration, customer association, or cashier fail with an idempotency fingerprint mismatch.

Deployment compatibility is also preserved for associated sales committed before M9. If an existing receipt is found under the same outlet/idempotency key, M9 may resolve the consumed association challenge read-only to prove it belongs to the stored customer and return that receipt. This lookup is never used to authorize a new sale, so a consumed challenge remains unusable under a new key.

## Customer association atomicity

Merchant POS no longer consumes a customer-association challenge in the controller before sale completion. The challenge is consumed inside the POS transaction. Challenge consumption, POS receipt/items, inventory movement, and eligible loyalty source now commit or roll back together. A stock race cannot burn a valid challenge.

## Offline boundary

`POS_SALE` is intentionally absent from Merchant offline command types. A forged POS offline command is rejected before network dispatch. Offline scanning/basket preparation may be added separately, but final POS completion remains an online authoritative operation.

## Schema decision

M9 requires no V32 migration. Existing catalog rows, inventory balances, reservations, POS sale tables, and transaction boundaries provide the required correctness primitives. Adding schema solely to mark the sprint would violate the forward-migration evidence rule.

## Executable evidence

- `backend/src/test/kotlin/in/mypetnew/merchantops/M9OrderPosConcurrencyPostgresContractTest.kt`
- `apps/merchant-app/src/sync/__tests__/m9-pos-online-boundary.test.ts`

The PostgreSQL suite covers POS-versus-order final-unit contention, catalog-lock blocking, online repricing, stale quote rollback, reservation release/fulfilment, transition replay, customer-association rollback/retry, and inventory-ledger reconciliation.
