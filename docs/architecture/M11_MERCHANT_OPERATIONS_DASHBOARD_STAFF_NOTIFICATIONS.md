# M11 Merchant Operations Dashboard, Staff, and Notifications

## Scope and canonical sources

M11 adds Merchant frontend views for an operations dashboard, bounded order work, staff permission management, the notification inbox, and durable sync/conflict status. The `/orders` screen reuses the canonical Merchant order APIs already present in M10; it is not a new order-detail authority.

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

The backend derives the snapshot in one fixed PostgreSQL aggregate statement over the canonical `appointment`, `catalog_listing`, `inventory_balance`, and `product_order` tables. Pending appointments are `BOOKED`; order work is `PLACED`, `ACCEPTED`, `PREPARING`, `READY_FOR_PICKUP`, or `PICKED_UP`; low stock is available quantity 1 through the returned threshold; and out of stock is zero available quantity. Inactive listings are excluded from catalog and inventory metrics. All-outlet requests are capped at 100 active authorized outlets and fail with `OUTLET_SCOPE_TOO_LARGE` instead of silently returning partial metrics. A caller with a larger estate can select one currently authorized outlet.

Staff data comes only from the bounded staff API:

- `GET /api/v1/merchant/staff?outletId=...&page=0&pageSize=100`
- `POST /api/v1/merchant/staff/grants` with exactly `{outletId, accountId, permission}`
- `DELETE /api/v1/merchant/staff/{accountId}/permissions/{permission}` with `{outletId}`

The UI accepts only a Merchant account ID and never sends a mobile target or `organizationId`. Staff responses match the current contract fields: `accountId`, `outletId`, `permission`, `active`, and `accountStatus`. The account ID does not establish organization authority. Notifications come from `GET /api/v1/merchant/notifications?page=0&pageSize=50`.

Staff, order-work, and notification pages are capped at 100 rows with a maximum offset of 100,000.

## Authentication and authorization boundary

All M11 network reads and mutations use the existing authenticated `merchantApiFetch` session boundary. Outlet IDs and frontend permission checks improve navigation and presentation only. They do not establish authority. The backend reauthorizes the current Merchant principal and enforces outlet membership and staff-management permission for every request; foreign or revoked scope therefore fails closed at the server.

Only an owner or outlet manager sees staff-management actions. Canonical `OWNER` membership is read-only on this surface: it is absent from assignable UI permissions, cannot be revoked in the UI, and is rejected by the backend with `OWNER_PERMISSION_IMMUTABLE`.

The controller canonically reauthorizes the token principal before every M11 dashboard, order-work, notification, or staff operation. Staff persistence then rechecks the live Merchant identity, organization, outlet, and permission rows inside a transaction while locking the relevant staff grants. Grants add or re-enable one existing `(account_id, outlet_id, permission)` row; revokes disable one exact non-owner permission. Cross-organization active membership is rejected. Client input never selects an organization.

## Offline and freshness semantics

Dashboard business metrics, staff grants, and notifications are online canonical reads. When they are unavailable, M11 shows an unavailable/error state and does not substitute local business values.

The SQLite operational summary is a separate device-health view. It reports only partition-scoped command states (pending, sending, retryable, needs reconciliation, rejected, blocked, and acknowledged). Projection freshness comes from the durable atomic `all` change-feed state written by the production reconciler. Legacy `CATALOG` and `INVENTORY` rows are shown only when no atomic state exists; M11 does not invent a `BARCODE` state. The local account, organization, and outlet identifiers are used only to select the device partition. Outbox-only partitions remain discoverable. A missing or unreadable local partition affects only this sync/conflict/freshness panel and never clears or replaces a valid server dashboard snapshot.

Appointment notifications may pass a validated UUID as `appointmentId`. The existing appointment screen uses that value only to prioritize an appointment already returned by the canonical appointment API; it never fabricates appointment state from navigation data.

## Safe notification navigation

Notification payload routes are treated as untrusted input and mapped through a fixed allowlist:

- appointment -> `/appointments` (with the validated prioritization hint described above)
- catalog -> `/catalog`
- inventory -> `/inventory`
- order -> `/orders` (the ID remains untrusted and is not used to fabricate detail state)
- unknown, malformed, or external route -> `/dashboard`

Payload strings are never passed directly to the router. The repository already has a canonical Merchant order-detail endpoint, and the M11 `/orders` worklist uses the bounded canonical order-work endpoint. No new order-detail route is introduced; malformed and unknown notification routes fall back to `/dashboard`.

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

Executable evidence is supplied by `M11MerchantOperationsPostgresContractTest`, the appointment and notification backend contracts, the focused frontend tests above, the full Merchant Jest suite, TypeScript, lint, migration validation, and the repository verification script. Environment-specific results belong in the implementation handoff rather than this architecture contract.
