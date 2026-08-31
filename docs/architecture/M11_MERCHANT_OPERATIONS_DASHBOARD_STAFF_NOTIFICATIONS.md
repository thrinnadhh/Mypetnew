# M11 Merchant Operations Dashboard, Staff, and Notifications

## Scope and canonical sources

M11 adds Merchant frontend views for an operations dashboard, staff permission management, and the notification inbox. It does not add an order screen or an `/orders` app route.

Business metrics come only from `GET /api/v1/merchant/dashboard`. The canonical response is:

```text
{
  outletIds: string[],
  generatedAt: string,
  metrics: {
    pendingAppointments: number,
    activeCatalog: number,
    lowStockInventory: number,
    outOfStockInventory: number,
    orderWork: number,
    lowStockThreshold: number
  }
}
```

The frontend validates this shape before rendering it. It may request the server-authorized all-outlet scope or one authorized outlet. It does not derive appointment, catalog, inventory, order, or threshold values from SQLite, cached projections, notification payloads, or client organization input. `generatedAt` describes server snapshot freshness.

The backend derives the snapshot in one fixed PostgreSQL aggregate statement over the canonical `appointment`, `catalog_listing`, `inventory_balance`, and `product_order` tables. Pending appointments are `BOOKED`; order work is `PLACED`, `ACCEPTED`, `PREPARING`, or `READY_FOR_PICKUP`; low stock is available quantity 1 through the returned threshold; and out of stock is zero available quantity. Inactive listings are excluded from catalog and inventory metrics. All-outlet requests are capped at 100 outlets and must exactly match currently active `merchant_staff`, organization, and outlet authority reconstructed inside the query.

Staff data comes only from the bounded staff API:

- `GET /api/v1/merchant/staff?outletId=...&page=0&pageSize=100`
- `POST /api/v1/merchant/staff/grants` with exactly `{outletId, accountId, permission}`
- `DELETE /api/v1/merchant/staff/{accountId}/permissions/{permission}` with `{outletId}`

The UI accepts only a Merchant account ID and never sends a mobile target or `organizationId`. Staff responses match the current contract fields: `accountId`, `outletId`, `permission`, `active`, and `accountStatus`. The account ID does not establish organization authority. Notifications come from `GET /api/v1/notifications?page=0&pageSize=50`.

Staff pages are capped at 100 rows and a maximum offset of 10,000. Notification pages are capped at 50 rows and the same maximum offset.

## Authentication and authorization boundary

All M11 network reads and mutations use the existing authenticated `merchantApiFetch` session boundary. Outlet IDs and frontend permission checks improve navigation and presentation only. They do not establish authority. The backend reauthorizes the current Merchant principal and enforces outlet membership and staff-management permission for every request; foreign or revoked scope therefore fails closed at the server.

Only an owner or outlet manager sees staff-management actions. Owner permission mutation remains owner-only in the UI, while backend authorization remains decisive for every list, grant, and revoke operation.

The controller canonically reauthorizes the token principal before every M11 dashboard or staff operation. Staff persistence then rechecks the live Merchant identity, organization, outlet, and permission rows inside a transaction while locking the outlet. Grants add or re-enable one existing `(account_id, outlet_id, permission)` row; revokes disable one exact permission. `OWNER` mutation requires live owner authority, cross-organization active membership is rejected, and the last active owner identity cannot be revoked. Client input never selects an organization.

## Offline and freshness semantics

Dashboard business metrics, staff grants, and notifications are online canonical reads. When they are unavailable, M11 shows an unavailable/error state and does not substitute local business values.

The SQLite operational summary is a separate device-health view. It reports only partition-scoped command states (pending, sending, retryable, needs reconciliation, rejected, blocked, and acknowledged) and freshness for the existing barcode, catalog, and inventory projections. The local account, organization, and outlet identifiers are used only to select the device partition. A missing or unreadable local partition affects only this sync/conflict/freshness panel and never clears or replaces a valid server dashboard snapshot.

Appointment notifications may pass a validated UUID as `appointmentId`. The existing appointment screen uses that value only to prioritize an appointment already returned by the canonical appointment API; it never fabricates appointment state from navigation data.

## Safe notification navigation

Notification payload routes are treated as untrusted input and mapped through a fixed allowlist:

- appointment -> `/appointments` (with the validated prioritization hint described above)
- catalog -> `/catalog`
- inventory -> `/inventory`
- order -> `/dashboard`
- unknown, malformed, or external route -> `/dashboard`

Payload strings are never passed directly to the router. Because no production order route existed, order dashboard cards and order notifications both fail safely to `/dashboard`.

## Schema and manifests

M11 requires no database migration. It adds no table, column, index, or offline command type. Existing migrations remain sealed. Merchant Operations manifests are unchanged.

The existing V1 `merchant_staff` key, appointment/order/catalog tables, V25 tenant-scoped inventory projection, notification storage, and SQLite sync/outbox schema already provide every required source. Reusing them avoids a second staff model, duplicate dashboard projection, or shadow appointment data.

## Test evidence

The M11 frontend evidence is concentrated in:

- `src/operations/dashboard.test.ts`
- `src/operations/staff.test.ts`
- `src/operations/notifications.test.ts`
- `src/operations/sync-summary.test.ts`
- `src/appointments/model.test.ts`

These tests cover the exact dashboard snapshot, server-only business metrics, fixed dashboard destinations, staff target request shapes, staff permission gating, notification route fallback, appointment prioritization without fabrication, and partition-scoped SQLite sync/freshness summaries.

Recorded results:

- focused Merchant M11 Jest: 5 suites and 19 tests passed;
- Merchant TypeScript (`tsc --noEmit`) and Expo lint (`expo lint --quiet`): passed;
- recorded PostgreSQL M11 contract run: 4 tests passed in the generated XML report after applying all 31 existing migrations to PostgreSQL 17.6; the later bounded-scope and active-identity owner assertions compile with the final test source, while a fresh managed-sandbox Gradle invocation stops before configuration because Gradle cannot open its local lock-listener socket;
- M11 backend domain and JDBC persistence sources: compiled with Kotlin 2.3.21, JVM 21, strict JSR-305 handling, and warnings as errors;
- `git diff --check`: passed.

The managed command sandbox cannot acquire the user's Gradle wrapper lock or open Gradle's local lock-listener socket, so a second Gradle execution from that sandbox is unavailable. The successful PostgreSQL result remains recorded at `backend/build/test-results/test/TEST-in.mypetnew.merchantops.M11MerchantOperationsPostgresContractTest.xml`.
