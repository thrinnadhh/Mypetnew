# Sprint 1 evidence record

Status: **SPRINT 1 NOT CERTIFIED**

This directory separates reproducible source evidence from infrastructure and physical-device evidence. A green local or CI build is necessary but cannot certify Sprint 1 by itself. Evidence must identify its commit, UTC timestamp, environment, migration version, and non-secret fixture/build identifiers as required by the hard-test contract.

## Reproducible source gates

| Gate | Command/evidence | Current result |
|---|---|---|
| backend clean build/domain/API/architecture | `./gradlew :backend:check --no-daemon --no-configuration-cache` | PASS locally |
| client lint | `pnpm lint` | PASS locally |
| client type safety | `pnpm typecheck` | PASS locally |
| client tests and coverage | `pnpm test:coverage` | PASS locally |
| production client builds | `pnpm build` | PASS locally |
| repository/client secret boundary | `./scripts/secret-scan.sh` | PASS locally |
| production dependency audit | `./scripts/dependency-audit.sh` | PASS with two CI-enforced expiring Expo build-tool exceptions documented in `docs/qa/SECURITY_EXCEPTIONS.md` |
| connected in-process walking skeleton | `WalkingSkeletonApiTest` | PASS locally |

CI uploads immutable backend and client reports under the commit SHA. The source suite covers domain invariants, role denial, API error shape, barcode isolation, inventory concurrency, quote/order/POS idempotency, merchant-scoped loyalty, migration privacy, notification dedupe, device role binding, and safe inbox routing.

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
