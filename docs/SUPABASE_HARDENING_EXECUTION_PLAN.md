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
- Project role: approved staging/development environment, not permanent production.
- Region: `ap-northeast-1`.
- PostgreSQL: 17.
- Project health: active/healthy.
- Supabase plan: Free; Supabase development branching is unavailable until Pro is enabled.
- Live `mypet.flyway_schema_history`: V1–V21 successful, zero failed migrations.
- Repository `main` migrations at program start: V1–V29.
- In-progress M8 branch already reserves V30 as `V30__merchant_inventory_operations_and_count.sql`.
- Live `mypet` table count: 68 before V22–V29 reconciliation.
- `mypet_runtime` role exists.
- Storage buckets: none at baseline.
- Realtime publication entries: none at baseline.
- Security Advisor: no findings.
- Performance Advisor: informational unindexed-FK findings and unused-index observations. These are not grounds for editing historical migrations or deleting indexes without workload evidence.
- Legacy public Captain tables exist but are empty and expose broad `public`/anonymous ALL policies: `captain_locations`, `captain_onboarding`, `captain_support_tickets`.

## User decisions — approved

1. `PetShop` is staging and may be migrated V22–V29 after safety gates pass.
2. Obsolete `public.captain_*` anonymous exposure may be disabled, with quarantine/drop allowed after evidence + regression tests prove the tables unused.
3. Future permanent production should target `ap-south-1` (Mumbai) rather than reusing the current staging project.
4. A temporary Supabase development branch was approved at the quoted $0.01344/hour, but creation was blocked because Branching requires Pro. No branch was created and no charge was incurred.

Fallback while billing remains disabled: GitHub Actions + disposable PostgreSQL/Testcontainers for migration certification; PetShop is touched only after a verified logical backup exists.

## Dependency schedule

| Order | Phase | Work | Tracking | Gate |
|---:|---:|---|---|---|
| 1 | 0 | Immutable repository/Supabase baseline | #126 | Read-only; evidence captured |
| 2 | 1 | Offline/CI certification of V22–V29 | #126 | Real PostgreSQL/Testcontainers + concurrency gates green |
| 3 | 2 | Controlled staging migration V22–V29 | #127 | Verified Free-tier logical backup + Phase 1 green |
| 4 | 3 | Least-privilege role/grant certification | #127 | Runtime cannot perform DDL/admin actions |
| 5 | 5 | Provision public catalog + private evidence Storage | #128 | Policy matrix verified |
| 6 | 6 | M7 real-Storage media reconciliation certification | #128 | Retry/crash/orphan safety verified |
| 7 | 4 | Legacy public Captain lockdown | #129 | Captain regression green; no broad anon ALL policy |
| 8 | 7 | Backup/restore drill | #130 | Restore + Flyway + critical invariants green |
| 9 | 15 | Supabase-aware CI contract | #131 | Deterministic checks on PR/exact head |
| 10 | 16 | Automated repo↔DB drift detection | #131 | Expected latest migration equals live latest |
| 11 | 17 | Security/Performance Advisor gate | #130 | No blocking security findings |
| 12 | 8 | PostGIS durable geography foundation | #132 | Current migration head + restore certified; no version collision |
| 13 | 9 | PGMQ decision | #131 | Deferred while outbox/inbox remain adequate |
| 14 | 10 | pg_cron decision | #131 | Deferred while Spring scheduler owns jobs |
| 15 | 11 | Supabase Auth decision | #131 | Explicitly not used; Spring auth stays authority |
| 16 | 12 | Edge Function boundary | #131 | No domain logic split across runtimes |
| 17 | 13 | Realtime decision | #131 | Deferred or safe projection only |
| 18 | 14 | pgvector decision | #131 | Deferred until measured search need |
| 19 | 18 | Production-region decision | #132 | `ap-south-1` target before launch cutover |

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

Required CI gates:

- repository migration continuity/immutability verification;
- Merchant Operations program validation;
- `:backend:merchantOpsPostgresTest` against disposable real PostgreSQL/Testcontainers;
- `:backend:merchantOpsConcurrencyTest`;
- full `:backend:check`, security/privacy scans and coverage gates.

V1–V21 remain sealed and unchanged.

## Phase 2 — reconcile staging

Only after Phase 1 and backup readiness:

1. establish a quiet write window;
2. create a verified logical backup using `scripts/supabase/export-free-tier-backup.sh` while the project remains Free;
3. verify the dump with `pg_restore --list`, preserve the generated SHA-256 checksums outside Git, and record pre-migration baseline evidence;
4. run Flyway validate using migration identity;
5. migrate V22→V29 using the repository application/Flyway path;
6. run Flyway validate again;
7. verify `max(version)=29`, zero failed migrations and expected schema objects;
8. restart backend using runtime identity;
9. run smoke/integration/M0–M7 exact-head certification.

Supabase Free projects do not have automatic daily backups, so no live application migration is allowed until the explicit logical export above succeeds. Do not apply application DDL through a competing Supabase migration history.

## Phase 3 — least privilege

Runtime identity requires only the DML/sequence privileges necessary for the application. It must fail `CREATE TABLE`, `ALTER`, `DROP`, `CREATE EXTENSION`, role/grant administration and other DDL/admin actions. Migration identity may perform committed Flyway DDL but receives no unnecessary Supabase-owned `auth`/`storage` privileges.

## Phase 4 — legacy `public.captain_*`

Baseline evidence already shows all three legacy public Captain tables contain zero rows and have broad `public` ALL policies. The repository has no current code references to these legacy names. Before mutation, run the full Captain app regression/architecture/export validation. Then:

1. revoke/remove anonymous/public broad access first;
2. verify Captain behavior again;
3. quarantine/drop only if all evidence continues to prove the tables obsolete.

## Phases 5–6 — Storage and M7 media

Expected buckets:

- `catalog-media`: public read; backend-only create/update/delete; constrained MIME/size/object names.
- `provider-verification-private`: no public list/read/write; backend-only writes; short-lived signed reads.

Certify offline `local:<uuid>` identity remap plus image retries, duplicate sync, timeout-response loss, app termination, account/outlet switch and orphan cleanup.

## Phase 7 — backup/restore

While staging remains on the Free plan, logical exports are the mandatory pre-change recovery point. Record RPO/RTO and perform a restore drill into an isolated local/disposable PostgreSQL target. The restored database must pass Flyway validation, backend startup and critical data/invariant checks for orders, inventory movements, payments/refunds, appointments, loyalty and merchant sync.

For future production, Pro-or-higher daily backups/PITR should be evaluated before launch.

## Phase 8 — PostGIS

Enable only after the application migration head and restore certification are current. **Do not create V30 in this branch:** M8 already reserves V30. Re-read `main` after M8 integration and allocate the next free migration version (V31 or later). Use PostGIS for durable location/serviceability and retain Redis for hot Captain proximity/dispatch unless benchmark evidence justifies a change.

## Phases 9–14 — deliberate deferrals

- PGMQ: defer while transactional outbox/inbox is adequate.
- pg_cron: defer while Spring scheduler owns jobs.
- Supabase Auth: do not introduce; Spring OTP/JWT/session remains authority.
- Edge Functions: keep domain logic in Spring.
- Realtime: defer; if later introduced, consume safe event projections, not direct sensitive transactional tables.
- pgvector: defer until conventional search is measured and semantic retrieval has a demonstrated need.

## Phases 15–16 — CI and drift prevention

Every PR must validate migration structure and repository contracts. The Supabase contract workflow also runs real PostgreSQL Merchant Operations and concurrency gates. Live-environment drift checks run only when a protected DB URL is available. Deployment certification fails when repository latest migration differs from live successful Flyway latest, expected buckets are absent, or required security boundaries are violated.

## Phase 17 — advisors

Run Supabase Security and Performance Advisors after DDL/security/storage changes. Security findings block certification. Performance findings are triaged against real query patterns before new forward migrations are added. Do not remove "unused" indexes based only on an early low-traffic advisor observation.

## Phase 18 — production region

Decision recorded: future permanent production targets `ap-south-1` (Mumbai). Before creation/cutover, benchmark application-to-database latency and confirm plan/cost requirements. Region migration is not bundled into the current staging hardening branch.

## Merge gates

- V1–V21 unchanged.
- V1→latest repository migration sequence is contiguous/unique.
- Real PostgreSQL migration/contract and concurrency certification green.
- Flyway validation green.
- Backend + Customer + Merchant + Captain applicable tests green.
- M0–M7 merchant certification green.
- `mypet` remains private.
- Runtime identity is least privilege.
- No privileged client secret is committed/bundled.
- Storage policy matrix passes before media certification.
- No blocking Supabase security advisor finding.
- Free-tier logical backup is verified before staging DDL.
- Backup/restore procedure is documented and exercised before production cutover.
