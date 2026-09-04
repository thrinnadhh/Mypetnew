# M13 E2E failure-mode certification

Status: **M13-E2E-001 candidate; M13-DEVICE-001 remains PLANNED**

## Scope

M13-E2E-001 certifies failure modes that can be exercised deterministically in repository CI. It does not claim physical-device camera/barcode behavior, native permission behavior, or measured on-device performance.

The exact-head gate is `.github/workflows/m13-e2e.yml`.

## Failure-mode mapping

| Required failure mode | Executable evidence |
|---|---|
| Airplane/offline mode | `apps/merchant-app/src/test-support/offline-harness.test.ts`, `apps/merchant-app/src/__tests__/m0-m7-offline-recovery-flow.test.ts` |
| Process death / restart | `apps/merchant-app/src/sync/__tests__/process-death.test.ts` |
| Timeout / response lost after server outcome | `apps/merchant-app/src/sync/__tests__/connected-unknown-outcome.test.ts`, PostgreSQL Merchant Operations suite |
| Duplicate replay / idempotency | `apps/merchant-app/src/sync/__tests__/sync-coordinator.test.ts`, `backend/src/test/kotlin/in/mypetnew/merchantops/M6SyncAdversarialPostgresContractTest.kt` |
| Multi-writer / multi-device conflict | `backend/src/test/kotlin/in/mypetnew/merchantops/M8InventoryConcurrencyAdversarialTest.kt`, `backend/src/test/kotlin/in/mypetnew/merchantops/M9OrderPosConcurrencyPostgresContractTest.kt` |
| Local SQLite corruption / recovery | `apps/merchant-app/src/data/database/__tests__/recovery.test.ts` |
| Local schema and forward migration upgrade path | `apps/merchant-app/src/data/database/__tests__/bootstrap-and-migrations.test.ts`, `scripts/merchant-operations/verify-forward-migrations.sh` |

## Certification rule

M13-E2E-001 may be marked `ENFORCED` only when the dedicated workflow passes on the exact candidate SHA together with the ordinary Merchant Operations, Merchant, backend, Supabase/PostgreSQL, Customer and Captain regression gates required by the repository.

A green M13-E2E workflow does **not** complete M13. `M13-DEVICE-001` remains independent and requires genuine physical Android evidence.

## Device boundary

The repository Sprint 1 exit gate requires a development build on a **real Android device** for physical scanner/native-push cases. Expo Go, unit tests, web tests, simulated camera data, and emulator-only evidence must not be presented as device certification.
