# M1 — Merchant Authority, Permissions, and Outlet Foundation

Status: implementation contract, certification record, and post-merge hardening record
Predecessor: M0 merged main `85188ac7f26927226862d9f04d85c9d634fcd9e9`
Original M1 merge: PR #102, main `bf82bd53f36ec7c4a70ffcdb28b99a7b148f3471`
Program obligations: `M1-AUTH-001`, `M1-AUTH-002`

## 1. Purpose

M1 is the first consumer of the M0 Merchant Operations program gates. It repairs the persistent onboarding authority gap and establishes the server-owned authority model that later Merchant catalog, inventory, barcode, offline, POS and Admin sprints must reuse.

M1 does not implement M2–M13 feature behavior.

## 2. Canonical authority model

- Spring Boot + PostgreSQL remain the canonical role, organization, outlet, membership and permission authority.
- Request-supplied organization/outlet identifiers are targets to validate, never authority.
- Every production Merchant request is reauthorized from current `identity_account` and `merchant_staff` rows.
- A Merchant account may authenticate before it owns an outlet; that scope-less principal is valid only for first onboarding.
- Provider onboarding atomically persists the owner membership for the created outlet as `OWNER`.
- `OWNER` is an outlet-scoped wildcard. Non-owner staff receive only explicit outlet-scoped permissions.
- An already-onboarded Merchant may create another outlet only while current server-owned authority still contains `OWNER` for that organization.
- `owner_actor_id` is identity/ownership metadata; it is never sufficient by itself to recreate revoked authority.
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
| Dispatch-origin configuration | `OUTLET_MANAGE` or `OWNER` | canonical membership + organization match; allowed during onboarding, denied for `SUSPENDED`/`REJECTED` outlets |

Merchant order reads retain the membership-only rule so suspension does not erase access to already-existing records.

## 5. Token and reauthorization contract

Access tokens can transport an outlet-permission snapshot, but production does not treat that snapshot as current authority. `MerchantReauthorizationFilter` resolves the current account, memberships and permissions on every authenticated Merchant request and replaces the token principal before controller execution.

The M1 token format remains backward-compatible with the prior nine-field access-token format. A legacy Merchant token carries no new permission grants; production reauthorization supplies the current PostgreSQL permission set before a protected command runs.

Merchant OTP verification must report an `accessTokenExpiresAt` consistent with the lifetime encoded into the signed access token. The canonical access-token lifetime is owned by `BearerTokenService`, not duplicated in the Merchant controller.

Unknown/invalid persisted Merchant permission values fail closed rather than being interpreted permissively.

## 6. Persistent onboarding, replay, revocation, and upgrade repair

`JdbcProviderPersistence.submit` creates the provider outlet and corresponding `merchant_staff` owner row within the same Spring transaction.

The canonical onboarding idempotency fingerprint is stable across the authority transition caused by first onboarding: organization scope is an effect of the accepted command and therefore is not part of the new canonical fingerprint. A retry of the identical onboarding command after request-time reauthorization must return the same outlet rather than become a false fingerprint mismatch. The service retains compatibility for M1 commands that may already have persisted the earlier organization-scoped fingerprint form.

An onboarding replay is authority-read-only. It returns the already accepted outlet but never creates, reactivates, or repairs an `OWNER` membership. This is required so both inactive-row revocation and deleted-row revocation remain authoritative. A missing legacy owner membership is repaired only by the explicit forward migration described below, not by replay side effects.

A scope-less Merchant is eligible only for genuinely first onboarding. If an organization already has that account as `owner_actor_id`, lack of a current `OWNER` membership cannot be bypassed by starting another onboarding command. A limited non-owner permission likewise cannot be used to create another outlet and obtain a fresh `OWNER` grant.

M1 adds forward-only migration `V22__merchant_owner_membership_backfill.sql`. It backfills missing `OWNER` membership for existing provider outlets whose organization already has a canonical Merchant `owner_actor_id`. Existing inactive `OWNER` rows are left inactive so migration cannot resurrect revoked authority. This is required because existing/staging provider rows can predate the fixed onboarding path. Historical migrations V1–V21 remain unchanged.

The P3 staging provider seed creates matching `OWNER` memberships so staged providers resolve canonical authority after seeding.

## 7. M1 certification evidence

Mandatory evidence is implemented in:

- `backend/src/test/kotlin/in/mypetnew/identity/MerchantPrincipalResolverContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/security/BearerTokenServiceContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/merchantops/M1MerchantAuthorityPostgresContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/merchantops/M1PostMergeHardeningContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/merchantops/M1ReplayRevocationDeletionContractTest.kt`
- `backend/src/test/kotlin/in/mypetnew/api/MerchantIdentityApiTest.kt`
- `backend/src/test/kotlin/in/mypetnew/api/WalkingSkeletonApiTest.kt`

The PostgreSQL contracts must prove:

1. onboarding creates one durable `OWNER` membership;
2. an identical onboarding replay remains stable after organization/OWNER scope materializes;
3. replay does not duplicate membership and cannot create/reactivate a revoked or deleted owner grant;
4. owner scope resolves from PostgreSQL and can use active-outlet commands;
5. a foreign outlet is denied;
6. an explicit limited permission succeeds only for the granted outlet/action;
7. a limited or revoked former owner cannot create another outlet to regain `OWNER`;
8. a current owner can create an additional outlet within the canonical organization;
9. permission revocation is effective after reauthorization;
10. suspended outlet transactional/configuration commands fail closed while membership remains available for read authorization;
11. membership revocation removes outlet scope entirely;
12. changed payload with a reused onboarding key still fails fingerprint validation;
13. a V21 database containing an existing canonical owner/outlet upgrades through V22 and gains exactly one usable `OWNER` membership when missing, while an already revoked `OWNER` remains revoked.

Merchant identity API evidence must additionally prove that reported access-token expiry is consistent with the signed token.

## 8. Exit conditions

M1 is complete/certified only when:

- M0 program validation remains green;
- `M1-AUTH-001` and `M1-AUTH-002` remain `ENFORCED` with real evidence paths;
- `program-state.json` continues to record M0 and M1;
- backend `check`, Merchant validation, Customer validation and program-contract checks all pass on the exact final PR head;
- real PostgreSQL M1 authority/replay/revocation tests are green;
- V22 clean-install and V21→V22 upgrade evidence is green and no historical migration is changed;
- no M2+ production behavior is pulled into this hardening;
- the exact green head is merged and merged `main` is verified to contain the same tree.

## 9. Repository enforcement caveat

The M0/M1 workflows provide the required checks, but repository branch/ruleset protection is a separate GitHub administration control. A certification report must not claim that GitHub prevents bypass unless `main` is actually protected with the four required contexts and up-to-date/conversation-resolution requirements.
