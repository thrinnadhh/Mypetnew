# M3 Merchant Inventory Ledger

## Purpose

M3 establishes one canonical server-side inventory authority for Merchant stock. Stock is not a freely mutable listing attribute. Accepted stock changes are represented by append-only `mypet.inventory_movement` rows, while `mypet.inventory_balance` is the transactionally maintained current-state projection used for bounded reads and stock checks.

The ledger is authoritative for on-hand quantity. For a listing in M3 scope:

`SUM(inventory_movement.quantity_delta) == inventory_balance.on_hand`

A reconciliation mismatch is surfaced as `INVENTORY_INTEGRITY_ERROR`; ordinary request handling does not silently repair it.

## Schema and transaction boundary

V24 (`V24__merchant_inventory_ledger_foundation.sql`) is forward-only and leaves historical migrations sealed. It:

- adds `organization_id` and `outlet_id` scope to inventory projections/movements;
- establishes scoped foreign keys and history/reference indexes;
- creates durable `inventory_command_receipt` records;
- creates uniqueness for one inventory balance-change outbox publication per accepted movement;
- appends deterministic system `OPENING_BALANCE` movements when pre-M3 balance state is not already represented by the ledger;
- installs a PostgreSQL trigger that rejects `UPDATE` and `DELETE` on `inventory_movement`.

For a JDBC mutation, the PostgreSQL transaction is:

1. validate listing scope;
2. ensure a balance projection exists;
3. lock the scoped balance row with `SELECT ... FOR UPDATE`;
4. check a durable receipt / legacy accepted movement for replay;
5. calculate and validate the next integer balance using checked arithmetic;
6. update the balance with an expected version predicate;
7. insert the immutable movement;
8. insert the durable command receipt;
9. insert `INVENTORY_BALANCE_CHANGED` in the transactional outbox;
10. commit.

Any failure before commit rolls back movement, balance, receipt, and publication together.

## Movement model

An accepted movement records the immutable business meaning needed by M3:

- organization;
- outlet;
- listing;
- integer quantity delta;
- reason;
- resulting on-hand and reserved projection values;
- actor;
- source/reference information;
- idempotency key;
- request fingerprint/operation scope;
- trace identifier;
- occurrence time.

Production code does not expose movement update/delete APIs. PostgreSQL rejects row mutation directly. Corrections are compensating movements rather than edits.

## M3 movement reasons

The Merchant M3 adjustment boundary accepts only:

- `MANUAL_INCREASE` with a positive delta;
- `MANUAL_DECREASE` with a negative delta.

`OPENING_BALANCE` is system/migration provenance, not a Merchant-adjustment reason. Existing order/POS reasons remain internal compatibility primitives for the pre-existing commerce flows; M3 does not implement M8 receiving, damage, expiry, shrinkage, transfer, lot, stock-count, or reconciliation workflows.

Unknown or non-M3 Merchant adjustment reasons fail closed with `INVENTORY_REASON_INVALID`.

## Integer and negative-stock policy

Inventory quantities are Kotlin/PostgreSQL integers. Merchant manual adjustments are non-zero and limited to 1,000,000 units in magnitude. Checked integer arithmetic rejects overflow as `INVENTORY_QUANTITY_INVALID`.

Negative on-hand is forbidden. Reserved stock must also remain non-negative and may never exceed on-hand. The negative-stock decision is made while the balance row is locked inside the same PostgreSQL transaction as movement creation, so correctness does not depend on a JVM-local mutex and remains valid across application instances.

## Authorization and tenant isolation

Merchant inventory APIs use current M1 server-resolved authority. The request supplies an outlet/listing target but never organization or actor authority.

- `OWNER` satisfies the M1 Merchant permission wildcard;
- `INVENTORY_WRITE` is the explicit inventory permission;
- other permissions such as `CATALOG_WRITE` do not grant inventory mutation authority;
- the M1 reauthorization filter reloads Merchant membership/permissions for each authenticated request, so revoked permissions/membership and suspended identities fail closed;
- the outlet must be current, active, in the current organization, and within the caller's outlet authority;
- the listing is resolved with organization + outlet + listing predicates before inventory access.

Merchant balance/history persistence queries are organization/outlet/listing scoped. Foreign UUID targeting follows the existing anti-enumeration contract and returns the repository's unavailable-resource error instead of disclosing foreign resource existence.

## Idempotency and fingerprint semantics

Retryable Merchant adjustments require `Idempotency-Key`.

The canonical fingerprint includes the business inputs that change command meaning:

- organization;
- outlet;
- listing;
- quantity delta;
- movement reason;
- reference type;
- reference id.

Trace IDs and resulting balance values are intentionally excluded because they are unstable/derived and must not make a legitimate lost-response replay fail.

The durable receipt scope is organization + current actor + idempotency key. Identical replay returns the canonical accepted movement without an additional balance change, movement, receipt, or outbox record. Reusing the same key for a changed fingerprint returns `IDEMPOTENCY_FINGERPRINT_MISMATCH`.

Concurrent identical retries serialize on PostgreSQL state/uniqueness and converge on one logical movement. Concurrent same-key/different-payload commands allow only the winning fingerprint; the conflicting meaning is rejected.

## Receipt semantics

`inventory_command_receipt` stores the accepted movement identity, operation scope, fingerprint, actor/scope, and resulting balance values needed to reconstruct the canonical result. Receipt persistence is in the mutation transaction. A failed or rejected command therefore cannot leave a receipt claiming success.

## Change publication

M3 reuses the repository transactional outbox. Each accepted movement creates exactly one pending `INVENTORY_BALANCE_CHANGED` event whose aggregate is that movement. A partial unique index prevents duplicate logical publications for the same movement.

Publication is inserted before commit in the same database transaction. Rejected commands create no successful publication; replay returns the accepted movement without inserting another outbox event. No external publication occurs before PostgreSQL commit.

## Legacy stock migration

V24 preserves existing stock rather than reinitializing balances. It backfills inventory tenant scope and calculates, per listing, the difference between the pre-M3 `inventory_balance.on_hand` value and the sum of existing movement deltas. A non-zero difference becomes one deterministic `OPENING_BALANCE` movement with:

- `source_type = MIGRATION`;
- `source_reference = V24_LEGACY_STOCK_OPENING_BALANCE`;
- the zero system actor;
- deterministic listing-derived identity/key provenance.

The existing balance is left unchanged, so post-upgrade ledger sum equals the preserved on-hand quantity. Medicine/catalog lifecycle data and M1 authority rows are not rewritten.

The P3 seed path was also changed so it no longer resets inventory balance directly; newly seeded inventory receives deterministic system opening movements and matching balance projections in one transaction.

## Merchant API and app

M3 adds the minimal Merchant inventory surface:

- current balance read;
- bounded, deterministically ordered movement history;
- delta-based manual adjustment.

There is deliberately no `set stock = N` API. Movement history is capped/paginated and ordered newest-first by occurrence time and movement ID.

The Merchant client creates one immutable logical command object containing its idempotency key. If a network response is ambiguous/lost, retrying that command reuses the exact same key instead of generating a new command identity.

## Customer, order, and POS compatibility

Customer/order/POS code continues to consume the same `InventoryService`/`JdbcInventoryPersistence` authority; M3 does not introduce a parallel listing stock column. Existing order reservation/release/fulfil and POS sale primitives still write through inventory movements and the same balance projection.

M3 does not implement M9 reservation semantics or define new order-vs-POS last-unit policy. It only establishes the concurrency-safe ledger primitive those later workflows consume.

## M8 and M9 boundaries

Out of M3 scope:

- receiving workflow, damage, expiry, shrinkage and returns;
- lots/batches and transfers;
- physical stock counts and reconciliation workflows;
- offline inventory synchronization;
- order/POS reservation redesign and last-unit race policy.

Those are owned by later Merchant Operations sprints. M3 provides reusable immutable movement, idempotency, locking, receipt and outbox foundations.

## Executable evidence

The M3 PostgreSQL evidence is centered in:

- `backend/src/test/kotlin/in/mypetnew/merchantops/M3InventoryPostgresContractTest.kt` — V23→V24 upgrade/opening stock, immutability, reconciliation, replay/fingerprint rejection, rollback, outbox atomicity, M1 authority and PostgreSQL concurrency races;
- `backend/src/test/kotlin/in/mypetnew/catalog/JdbcInventoryPersistenceContractTest.kt` — existing order/POS inventory persistence regression;
- `backend/src/test/kotlin/in/mypetnew/persistence/FlywaySchemaContractTest.kt` — schema contract regression;
- `apps/merchant-app/src/inventory/api.test.ts` and `apps/merchant-app/app/inventory.test.tsx` — retry-safe Merchant client and minimal screen behavior;
- existing Customer/backend regression lanes executed by repository CI.

`M3-INV-001` and `M3-INV-002` must remain non-enforced in the program manifest until this executable evidence and the repository exact-head gates pass. Program-state completion is committed only after that evidence is green, which necessarily creates a new head that must be certified again.
