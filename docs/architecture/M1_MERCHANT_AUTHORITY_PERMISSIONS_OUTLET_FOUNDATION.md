# M1 — Merchant Authority, Permissions, and Outlet Foundation

Status: implementation contract and certification record  
Predecessor: M0 merged main `85188ac7f26927226862d9f04d85c9d634fcd9e9`  
Program obligations: `M1-AUTH-001`, `M1-AUTH-002`

## 1. Purpose

M1 is the first consumer of the M0 Merchant Operations program gates. It repairs the persistent onboarding authority gap and establishes the server-owned authority model that later Merchant catalog, inventory, barcode, offline, POS and Admin sprints must reuse.

M1 does not implement M2–M13 feature behavior.

## 2. Canonical authority model

- Spring Boot + PostgreSQL remain the canonical role, organization, outlet, membership and permission authority.
- Request-supplied organization/outlet identifiers are targets to validate, never authority.
- Every production Merchant request is reauthorized from current `identity_account` and `merchant_staff` rows.
- A Merchant account may authenticate before it owns an outlet; that scope-less principal is valid only for onboarding.
- Provider onboarding atomically persists the owner membership for the created outlet as `OWNER`.
- `OWNER` is an outlet-scoped wildcard. Non-owner staff receive only explicit outlet-scoped permissions.
- A permission granted for Outlet A never authorizes Outlet B.
- A malformed membership whose `organization_id` does not match the canonical outlet organization is ignored by resolution and therefore grants no authority.
- Revoking a permission or membership affects the next online request/replay because request-time reauthorization replaces stale token claims.
- Suspending an outlet blocks new transactional commands while the membership may remain available for authorized historical/read use.

## 3. Merchant permission vocabulary introduced by M1

- `OWNER`
- `OUTLET_MANAGE`
- `CATALOG_WRITE`
- `INVENTORY_WRITE`
- `ORDER_FULFIL`
- `POS_OPERATE`
- `LOYALTY_OPERATE`

Later sprints may add permission values only when a real command family requires them. They must not use client role/permission fields as authority.

## 4. Existing command gates activated in M1

| Command family | Required permission | Additional authority |
|---|---|---|
| Catalog listing mutation | `CATALOG_WRITE` or `OWNER` | active canonical outlet + organization match |
| Inventory receiving | `INVENTORY_WRITE` or `OWNER` | active canonical outlet + organization match |
| Order fulfilment transition | `ORDER_FULFIL` or `OWNER` | active canonical outlet + organization match |
| POS completion | `POS_OPERATE` or `OWNER` | active canonical outlet + organization match |
| Dispatch-origin configuration | `OUTLET_MANAGE` or `OWNER` | canonical membership + organization match; may be used during onboarding |

Merchant order reads retain the membership-only rule so suspension does not erase access to already-existing records.

## 5. Token and reauthorization contract

Access tokens can transport an outlet-permission snapshot, but production does not treat that snapshot as current authority. `MerchantReauthorizationFilter` resolves the current account, memberships and permissions on every authenticated Merchant request and replaces the token principal before controller execution.

The M1 token format remains backward-compatible with the prior nine-field access-token format. A legacy Merchant token carries no new permission grants; production reauthorization supplies the current PostgreSQL permission set before a protected command runs.

Unknown/invalid persisted Merchant permission values fail closed rather than being interpreted permissively.

## 6. Persistent onboarding and upgrade repair

`JdbcProviderPersistence.submit` creates the provider outlet and corresponding `merchant_staff` owner row within the same Spring transaction. An idempotent onboarding replay also ensures the owner membership exists and is active, so retry cannot return an outlet that lacks canonical owner scope.

M1 adds forward-only migration `V22__merchant_owner_membership_backfill.sql`. It backfills `OWNER` membership for existing provider outlets whose organization already has a canonical Merchant `owner_actor_id`. This is required because existing/staging provider rows can predate the fixed onboarding path. Historical migrations V1–V21 remain unchanged.

The P3 staging provider seed now creates matching `OWNER` memberships so re-running that seed after V22 cannot recreate scope-less staged owners.

## 7. M1 certification evidence

Mandatory evidence is implemented in:

- `backend/src/test/kotlin/in/mypetnew/identity/MerchantPrincipalResolverContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/security/BearerTokenServiceContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/merchantops/M1MerchantAuthorityPostgresContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/api/WalkingSkeletonApiTest.kt`

The PostgreSQL contract must prove:

1. onboarding creates one durable `OWNER` membership;
2. idempotent replay does not duplicate membership;
3. owner scope resolves from PostgreSQL and can use active-outlet commands;
4. a foreign outlet is denied;
5. an explicit limited permission succeeds only for the granted outlet/action;
6. permission revocation is effective after reauthorization;
7. suspended outlet commands fail closed while membership remains available for read authorization;
8. membership revocation removes outlet scope entirely;
9. a V21 database containing an existing canonical owner/outlet upgrades through V22 and gains exactly one usable `OWNER` membership.

## 8. Exit conditions

M1 is complete only when:

- M0 program validation remains green;
- `M1-AUTH-001` and `M1-AUTH-002` are `ENFORCED` with real evidence paths;
- `program-state.json` records M1 only after evidence is green;
- backend `check`, Merchant validation, Customer validation and program-contract checks all pass on the exact final PR head;
- V22 clean-install and V21→V22 upgrade evidence is green and no historical migration is changed;
- no M2+ production behavior is pulled into this sprint;
- the exact green head is merged and merged `main` is certified.
