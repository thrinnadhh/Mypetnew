# Sprint 1 evidence record

Status: **SPRINT 1 NOT CERTIFIED**

This directory separates reproducible source evidence from infrastructure and physical-device evidence. A green local or CI build is necessary but cannot certify Sprint 1 by itself. Evidence must identify its commit, UTC timestamp, environment, migration version, and non-secret fixture/build identifiers as required by the hard-test contract.

## Reproducible source gates

| Gate | Command/evidence | Current result |
|---|---|---|
| backend clean build/domain/API/architecture | `./gradlew :backend:check --no-daemon --no-configuration-cache` | PASS locally; 80% JaCoCo gate covers domain/application code, while PostgreSQL/cloud infrastructure adapters remain in the separate staging gate |
| client lint | `pnpm lint` | PASS locally |
| client type safety | `pnpm typecheck` | PASS locally |
| client tests and coverage | `pnpm test:coverage` | PASS locally |
| production client builds | `pnpm build` | PASS locally |
| repository/client secret boundary | `./scripts/secret-scan.sh` | PASS locally |
| production dependency audit | `./scripts/dependency-audit.sh` | PASS with two CI-enforced expiring Expo build-tool exceptions documented in `docs/qa/SECURITY_EXCEPTIONS.md` |
| connected in-process walking skeleton | `WalkingSkeletonApiTest` | PASS locally |

CI uploads immutable backend and client reports under the commit SHA. The source suite covers domain invariants, role denial, API error shape, rotating sessions, barcode isolation, inventory concurrency, quote/order/POS idempotency, merchant-scoped loyalty, migration privacy, private-storage policy, FCM result classification, notification retry/dead-letter behavior, device role binding, and safe inbox routing.

## Latest local verification record

| Field | Value |
|---|---|
| verified source commit | `b4f8f1ee65ab1a85b27437a7dafaa735b335ef61` |
| completed at | `2026-08-11T16:09:04Z` |
| environment | local macOS source gate only; no Supabase/Firebase staging or physical device |
| toolchains | OpenJDK `21.0.11`, Node `22.23.2`, pnpm `11.21.0` |
| database contract version | Flyway `V3__notification_worker_claims.sql` (static/H2-compatible contract checks only) |
| backend result | 43 tests, 0 failures/errors; JaCoCo instruction coverage `8640/10128` (`85.31%`) for the domain/application scope |
| client result | 13 tests, 0 failures; 100% coverage for exercised shared modules; lint and typecheck pass |
| build result | Next.js Admin production build and Customer/Merchant/Captain Android Expo exports pass |
| security result | repository secret scan passes; dependency gate passes with one below-threshold Moderate advisory and the two expiring High Expo build-tool exceptions |

The commands were `./scripts/verify.sh` and `./scripts/dependency-audit.sh`. Generated build and test artifacts remain local/CI outputs rather than committed evidence.

## Blocking source/runtime work

| Area | Status | Required completion evidence |
|---|---|---|
| durable commerce transaction spine | NOT IMPLEMENTED | PostgreSQL repositories and atomic transactions/outbox for provider, catalog, inventory, cart, quote, order, POS and loyalty, exercised through the production profile |
| production identity lifecycle | NOT IMPLEMENTED | external OTP adapter plus persistent/race-safe challenge limits, Merchant/Admin bootstrap and live role/permission revocation |
| complete role workflows | NOT IMPLEMENTED | Customer/Merchant critical screens, Merchant scanner/manual/offline inventory flow, order fulfilment, POS/association/loyalty, and Admin approval UI against canonical APIs |
| production-profile integration suite | NOT IMPLEMENTED | PostgreSQL-backed API/E2E tests for rollback, concurrency, idempotency, tenant authorization, audit and outbox recovery |

The production profile is intentionally fail-closed: it does not substitute the test/development in-memory commerce services or OTP provider. Until this table is cleared, the source implementation itself is not Sprint 1 complete even if every reproducible gate above is green.

## Blocking certification gates

| Gate | Status | Evidence needed |
|---|---|---|
| Supabase PostgreSQL clean/upgrade/drift/connection/restore | NOT RUN | isolated staging project reports for S1-SUP-001..007 and 011..012 |
| Supabase private Storage authorization/abuse | NOT RUN | real private bucket and signed-access evidence for S1-SUP-008..010 |
| Firebase provider/retry/dead-letter/token cleanup | NOT RUN | isolated Firebase project, injected outage, replay and delivery records |
| physical Android scanner | NOT RUN | development-build device record; Expo Go/emulator is invalid |
| physical Android Customer/Merchant push | NOT RUN | foreground/background/killed delivery and deep-link record |
| connected staging E2E | NOT RUN | S1-E2E-001..009 against real infrastructure |
| operational recovery/observability | NOT RUN | backup restore, reconciliation, alert and runbook exercise |
| Product/Engineering/QA/Security sign-off | NOT RUN | named, dated release-candidate approval |

Do not replace any `NOT RUN` result with an assumption, mock, emulator result, or compilation result. An iOS release candidate additionally requires physical-iPhone APNs-through-FCM evidence before distribution.
