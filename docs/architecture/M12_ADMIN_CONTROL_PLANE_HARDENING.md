# M12 Admin control-plane hardening

## Scope

M12 hardens the existing backend Admin surface used by Merchant Operations. The repository does not currently contain an Admin web application, so this sprint deliberately does not invent one. It establishes production backend authority that a later Admin client can consume.

## Enforced design

- `ADMIN` remains the only role accepted for Admin operations and every operation requires its named `AdminPermission`.
- Cross-tenant access is explicit: inventory and audit reads carry both `organizationId` and `outletId`; the backend re-resolves the outlet and fails closed when they do not match.
- Cross-tenant reads require `X-Admin-Purpose` and `X-Admin-Reason`. Purpose is operation-specific, reason is trimmed, bounded, and rejects control characters.
- Provider approval keeps the existing idempotent domain transition, but now requires `PROVIDER_REVIEW` purpose/reason context and records an idempotent `audit_event` in the same outer transaction.
- Admin inventory is a bounded read projection over canonical `catalog_listing` + `inventory_balance`. It exposes no stock mutation command.
- Existing Merchant inventory commands continue to require canonical `MERCHANT` plus current outlet `INVENTORY_WRITE`; an `ADMIN` principal cannot use those endpoints even if it holds every Admin permission.
- Audit reads require `AUDIT_VIEW`, are target-scoped, bounded, and their access is itself audited.

## API contract

### Provider approval

`POST /api/v1/admin/outlets/{outletId}/approve`

Required headers: `Authorization`, `Idempotency-Key`, `X-Admin-Purpose: PROVIDER_REVIEW`, and a specific `X-Admin-Reason`.

### Inventory investigation

`GET /api/v1/admin/organizations/{organizationId}/outlets/{outletId}/inventory?page=0&pageSize=50`

Requires `CATALOG_MODERATION`, `X-Admin-Purpose: INVENTORY_INVESTIGATION`, and `X-Admin-Reason`. Page size is capped at 100. This endpoint is intentionally read-only.

### Audit review

`GET /api/v1/admin/organizations/{organizationId}/outlets/{outletId}/audit?page=0&pageSize=50`

Requires `AUDIT_VIEW`, `X-Admin-Purpose: AUDIT_REVIEW`, and `X-Admin-Reason`. Results are limited to the requested outlet target.

## Audit/idempotency semantics

`mypet.audit_event` already contains actor, role, action, target, reason, source, idempotency key, trace ID, and timestamp, so M12 requires no schema migration. Provider approval serializes audit replay through the existing outlet row lock. Reusing an idempotency key with a changed purpose/reason fails with `IDEMPOTENCY_FINGERPRINT_MISMATCH`; an identical replay returns the canonical approval without creating a second audit effect.

## Executable evidence before certification

- `backend/src/test/kotlin/in/mypetnew/merchantops/M12AdminControlPlanePostgresContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/api/M12AdminApiContractTest.kt`

`M12-ADMIN-001` remains `PLANNED` until GitHub CI is green on the exact implementation head. Only then may the manifest be changed to `ENFORCED`, followed by a fresh exact-head CI run on the certification commit.
