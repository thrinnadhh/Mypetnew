# Merchant Operations test obligations

The machine-readable source is
`contracts/merchant-operations/test-obligations.json`. This document explains
how implementation sprints use it.

## Lifecycle

1. M0 creates each M1–M13 obligation as `PLANNED`.
2. The owning sprint implements the production behavior and lowest useful test.
3. The sprint changes its obligations to `ENFORCED` and records real repository
   evidence paths.
4. Only after every owned obligation is enforced may the sprint be added to
   `program-state.json`.
5. CI validates dependency closure, evidence existence, and test integrity.

An evidence path proves only what its assertions execute. A compilation check,
mock-only test, H2 race, Expo export, or manual claim cannot substitute for a
required PostgreSQL, process-restart, multi-device, or physical-camera test.

## Test taxonomy

| Tag/lane | Purpose |
|---|---|
| `merchant-ops-contract` | Domain/API/architecture contracts required by the program. |
| `merchant-ops-postgres` | PostgreSQL dialect, migration, lock, transaction, and constraint behavior. |
| `merchant-ops-concurrency` | Barrier-started races with bounded timeouts and final-state assertions. |
| Merchant `test:offline` | Deterministic offline/restart harness and later durable SQLite behavior. |
| Customer `test:merchant-consistency` | Catalog, cart, quote, checkout, price, and availability regression. |

Skipped or focused tests are forbidden in governed sources. A genuine external
blocker is documented as blocked; it is never translated into success.
