# M0 Merchant Operations program foundation

Status: **implementation contract**
Baseline: `main@f3df6dc9aec45890a8b4add95850f5c278641496`

M0 precedes M1–M13 and makes the Merchant Operations architecture executable in
CI. It adds no Merchant-visible feature and no database migration.

## Authority

Spring Boot and PostgreSQL remain canonical. Mobile persistence is eventually a
durable cache/outbox, never marketplace inventory authority. M0 records these
rules in `contracts/merchant-operations/invariants.json` and maps every sprint
to test obligations.

## Certification model

- `program-state.json` may list a sprint only after all obligations it owns are
  enforced by existing, enabled evidence paths.
- `validate-program.mjs` rejects incomplete dependency closure, missing
  evidence, focused/skipped tests, privileged client configuration, and direct
  Supabase table access from role clients.
- historical Flyway files V1–V21 are checksum sealed and PR changes to any
  pre-existing migration fail.
- the backend test package supplies real-PostgreSQL, tenant fixture, replay,
  deterministic clock, and bounded concurrency support.
- the Merchant test package supplies deterministic network, response, clock,
  identity, and service-restart support without claiming SQLite durability.
- existing backend, Merchant, and Customer workflows remain product gates; a
  fourth lightweight workflow validates program integrity.

## Required checks

1. `ci / verify-backend`
2. `validate-merchant / merchant-app`
3. `validate-restored-customer / customer-app`
4. `merchant-operations-contract / program-contract`

M0 does not fix the persistent provider-onboarding membership defect. M1 is the
first consumer of this framework and must activate the authority, permission,
revocation, suspension, and cross-tenant obligations.
