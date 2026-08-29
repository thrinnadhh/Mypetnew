# MyPetNew Supabase Hardening Execution Plan

Tracking: #125

Branch: `infra/supabase-hardening-v29`

## Architectural invariants

- Spring Boot is the business and authorization authority.
- Flyway is the only owner of the private `mypet` application schema.
- Customer, Merchant, Captain and Admin clients never receive a database password or Supabase secret/service-role key.
- `mypet` is not exposed as a direct client/Data API schema.
- Historical applied migrations are immutable. Corrections are forward-only.
- Supabase-specific features are introduced only when they have a measured use case and a single clear owner.

## Verified starting point — 2026-08-29

- Supabase project: `PetShop` (`gxxmbmcezyuqwywblzlh`).
- Region: `ap-northeast-1`.
- PostgreSQL: 17.
- Project health: active/healthy.
- Live `mypet.flyway_schema_history`: V1–V21 successful.
- Repository migrations: V1–V29.
- Live `mypet` table count: 68 before V22–V29 reconciliation.
- `mypet_runtime` role exists.
- Security Advisor: no findings.
- Performance Advisor: informational unindexed-FK findings and unused-index observations. These are not grounds for editing historical migrations or deleting indexes without workload evidence.

## Required user decisions

Before live-risk/destructive steps:

1. Confirm whether PetShop is staging rather than permanent production.
2. Approve disabling/quarantining/removing obsolete `public.captain_*` access after usage/data evidence is captured.
3. Decide whether permanent production remains `ap-northeast-1` or is created in an India-near region such as `ap-south-1` before launch data accumulates.

Read-only auditing, repository changes and CI certification do not depend on these decisions.

## Dependency schedule

| Order | Phase | Work | Tracking | Gate |
|---:|---:|---|---|---|
| 1 | 0 | Immutable repository/Supabase baseline | #126 | Read-only; evidence captured |
| 2 | 1 | Offline/CI certification of V22–V29 | #126 | No live DDL; all tests green |
| 3 | 2 | Controlled staging migration V22–V29 | #127 | Backup checkpoint + Phase 1 green |
| 4 | 3 | Least-privilege role/grant certification | #127 | Runtime cannot perform DDL/admin actions |
| 5 | 5 | Provision public catalog + private evidence Storage | #128 | Policy matrix verified |
| 6 | 6 | M7 real-Storage media reconciliation certification | #128 | Retry/crash/orphan safety verified |
| 7 | 4 | Legacy public Captain lockdown | #129 | No broad anon ALL policy; drop only with approval |
| 8 | 7 | Backup/restore drill | #130 | Restore + Flyway + critical invariants green |
| 9 | 15 | Supabase-aware CI contract | #131 | Deterministic checks on PR/exact head |
| 10 | 16 | Automated repo↔DB drift detection | #131 | Expected latest migration equals live latest |
| 11 | 17 | Security/Performance Advisor gate | #130 | No blocking security findings |
| 12 | 8 | PostGIS durable geography foundation | #132 | V29/restore certified; new V30+ only |
| 13 | 9 | PGMQ decision | #131 | Deferred while outbox/inbox remain adequate |
| 14 | 10 | pg_cron decision | #131 | Deferred while Spring scheduler owns jobs |
| 15 | 11 | Supabase Auth decision | #131 | Explicitly not used; Spring auth stays authority |
| 16 | 12 | Edge Function boundary | #131 | No domain logic split across runtimes |
| 17 | 13 | Realtime decision | #131 | Deferred or safe projection only |
| 18 | 14 | pgvector decision | #131 | Deferred until measured search need |
| 19 | 18 | Production-region decision | #132 | Intentional decision before launch cutover |

## Phase 0 — immutable baseline

Capture without credentials/customer content:

- project ref, region and Postgres version;
- repository HEAD and latest migration;
- `mypet.flyway_schema_history` versions/checksums/success state;
- application schema table count;
- database roles and relevant grants;
- extensions;
- Storage bucket definitions;
- RLS policies, especially legacy `public.captain_*` surfaces;
- Realtime publications;
- Data API exposed-schema setting if visible;
- Security/Performance Advisor output.

Never perform `flyway clean`, delete history, or use `repair` to conceal checksum/version drift.

## Phase 1 — certify V22–V29 without touching staging

Expected forward migrations:

- V22 merchant owner membership backfill
- V23 catalog lifecycle/history idempotency
- V24 captain proof/onboarding/support/earnings
- V25 merchant inventory ledger foundation
- V26 device registration account switch
- V27 catalog media lifecycle
- V28 catalog media finalization hardening
- V29 merchant sync change log

Run repository contract validation, Gradle backend checks and M0–M7 merchant certification. Verify V1–V21 are unchanged.

## Phase 2 — reconcile staging

Only after Phase 1 and backup readiness:

1. establish a quiet write window;
2. capture backup checkpoint and pre-migration row/invariant evidence;
3. run Flyway validate using migration identity;
4. migrate V22→V29 using the repository application/Flyway path;
5. run Flyway validate again;
6. verify `max(version)=29`, zero failed migrations and expected schema objects;
7. restart backend using runtime identity;
8. run smoke/integration/M0–M7 exact-head certification.

Do not apply application DDL through a competing Supabase migration history.

## Phase 3 — least privilege

Runtime identity requires only the DML/sequence privileges necessary for the application. It must fail `CREATE TABLE`, `ALTER`, `DROP`, `CREATE EXTENSION`, role/grant administration and other DDL/admin actions. Migration identity may perform committed Flyway DDL but receives no unnecessary Supabase-owned `auth`/`storage` privileges.

## Phase 4 — legacy `public.captain_*`

Capture row counts, policies, grants and usage evidence first. Remove anonymous/public broad policies before considering table removal. Export retained data. Re-test Captain flows. Quarantine/drop only when proven obsolete and approved.

## Phases 5–6 — Storage and M7 media

Expected buckets:

- `catalog-media`: public read; backend-only create/update/delete; constrained MIME/size/object names.
- `provider-verification-private`: no public list/read/write; backend-only writes; short-lived signed reads.

Certify offline `local:<uuid>` identity remap plus image retries, duplicate sync, timeout-response loss, app termination, account/outlet switch and orphan cleanup.

## Phase 7 — backup/restore

Record RPO/RTO. Perform a restore drill into an isolated target when available. The restored database must pass Flyway validation, backend startup and critical data/invariant checks for orders, inventory movements, payments/refunds, appointments, loyalty and merchant sync.

## Phase 8 — PostGIS

Enable only after V29 and restore certification. Introduce new schema changes as V30+; never edit V1–V29. Use PostGIS for durable location/serviceability and retain Redis for hot Captain proximity/dispatch unless benchmark evidence justifies a change.

## Phases 9–14 — deliberate deferrals

- PGMQ: defer while transactional outbox/inbox is adequate.
- pg_cron: defer while Spring scheduler owns jobs.
- Supabase Auth: do not introduce; Spring OTP/JWT/session remains authority.
- Edge Functions: keep domain logic in Spring.
- Realtime: defer; if later introduced, consume safe event projections, not direct sensitive transactional tables.
- pgvector: defer until conventional search is measured and semantic retrieval has a demonstrated need.

## Phases 15–16 — CI and drift prevention

Every PR must validate migration structure and repository contracts. Live-environment drift checks run only when a protected DB URL is available. Deployment certification fails when repository latest migration differs from live successful Flyway latest, expected buckets are absent, or required security boundaries are violated.

## Phase 17 — advisors

Run Supabase Security and Performance Advisors after DDL/security/storage changes. Security findings block certification. Performance findings are triaged against real query patterns before new forward migrations are added.

## Phase 18 — production region

Benchmark India-to-`ap-northeast-1` latency and decide whether permanent production should be created in `ap-south-1` before important production data exists. Region migration is not bundled into the staging hardening branch.

## Merge gates

- V1–V21 unchanged.
- V1→latest repository migration sequence is contiguous/unique.
- Flyway validation green.
- Backend + Customer + Merchant + Captain applicable tests green.
- M0–M7 merchant certification green.
- `mypet` remains private.
- Runtime identity is least privilege.
- No privileged client secret is committed/bundled.
- Storage policy matrix passes before media certification.
- No blocking Supabase security advisor finding.
- Backup/restore procedure is documented and exercised before production cutover.
