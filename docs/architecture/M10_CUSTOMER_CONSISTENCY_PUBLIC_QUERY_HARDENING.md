# M10 Customer Consistency and Public Query Hardening

## Authority model

Customer commerce state is derived from committed PostgreSQL state. Merchant offline drafts and unsynchronized local media remain Merchant-local and are not part of any public read path.

The authoritative chain is:

`Merchant canonical commit -> PostgreSQL -> bounded public read model -> Customer detail/cart -> batch revalidation -> quote -> checkout lock`

Quote and checkout remain the final transaction authority established by M9. M10 does not make the Customer app authoritative for price, stock, listing state, outlet state, commerce mode, or serviceability.

## Public read model

Production public outlet/catalog reads use `JdbcPublicCatalogReadRepository`. Collection queries apply filters, stable ordering, `LIMIT pageSize + 1`, and `OFFSET` in PostgreSQL before DTO materialization. Detail reads address one listing. Inventory availability is joined from `inventory_balance`; summary media uses the canonical first image; detail/batch media uses one bounded image query.

The pre-M10 path materialized all active listings/outlets and called inventory/provider hydration per row before paginating. M10 removes that production N+1/full-materialization path. Test/development profiles retain the in-memory fallback so domain tests can keep using existing fixtures without becoming production authority.

Page size is capped at 50 and the maximum accepted offset is 100,000. Offset pagination is intentionally retained for V1 because all supported sort modes already have deterministic UUID tie-breakers and the bounded offset avoids unbounded deep scans. A cursor migration is deferred until production depth or measured plans justify the API complexity.

## Cart revalidation

`POST /api/v1/public/cart/revalidate` accepts one outlet, one valid service PIN, and at most 50 unique listing lines. Request price/quantity values are comparison inputs only.

The server batch-loads canonical listing/outlet/inventory state and media, rejects mixed-outlet/duplicate/oversized requests, and returns deterministic listing-ID order with these material outcomes:

- `PRICE_CHANGED`
- `QUANTITY_REDUCED`
- `PRODUCT_UNAVAILABLE`
- `STORE_UNAVAILABLE`
- `SERVICEABILITY_CHANGED`

`VIEW_ONLY` listings are non-purchasable. Inactive/deactivated entities fail closed. The Customer client updates only affected lines, preserves still-valid lines, surfaces the existing material-change review flow, and still requests a fresh server quote before checkout.

## Cache and freshness

No Redis or backend in-memory public catalog cache exists in the M9 repository path. Production M10 reads query PostgreSQL directly, so a committed Merchant mutation is visible to the next authoritative read without process restart or explicit cache invalidation.

Customer product/cart state is ephemeral React state. Live cart revalidation replaces cached line snapshots with canonical DTOs. Demo fixtures remain gated behind `allowDemoMode` and are not production fallbacks.

## Query-plan and index decision

`M10PublicCatalogQueryPostgresContractTest` seeds 1,200 representative listings and runs `EXPLAIN (ANALYZE, BUFFERS)` for the public-page shape. The contract asserts the plan contains the SQL `Limit` boundary and executes the catalog relation; it intentionally avoids brittle exact-cost assertions.

M10 adds no index and no migration. Existing primary/foreign-key relations support the joins and the broad first-page query still has to consider a large fraction of eligible rows for `LOWER(name)` sorting. Adding a speculative expression/trigram index without a demonstrated selective workload would add write amplification without proven benefit. If production search/deep-page telemetry later demonstrates a bottleneck, that is a forward migration decision.

## Flyway

M10 requires no migration. Schema remains V31. Existing V1-V31 migrations are untouched.

## Evidence

- `backend/src/test/kotlin/in/mypetnew/merchantops/M10CustomerConsistencyPostgresContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/merchantops/M10PublicCatalogQueryPostgresContractTest.kt`
- `apps/customer-app/src/services/__tests__/m10-cart-revalidation.test.ts`

These tests cover canonical metadata/price/stock/media changes, deactivation, serviceability/store changes, deterministic bounded pages, final-unit Customer concurrency, loser cleanup, non-negative inventory, and immutable historical order-line snapshots.
