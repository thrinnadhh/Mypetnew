# MI-2 — Supabase Core Data Architecture Certification

## Objective

MI-2 certifies the existing PostgreSQL/Supabase data authority after MI-1 isolation. It does not recreate domain tables already delivered through Flyway V1–V31.

## Canonical boundaries

- Spring Boot remains the only business/authentication/authorization authority.
- Flyway under `backend/src/main/resources/db/migration` remains the only application schema history.
- `mypet_runtime` is the DML-only application runtime identity and is separate from the migration identity.
- Customer and Merchant clients do not receive database credentials or use direct Supabase domain-table CRUD/RPC.
- PostGIS is installed in `extensions`; generated geography projections supplement, but do not replace, canonical latitude/longitude values.
- New indexes require query evidence; MI-2 preserves the two V31 geography GiST indexes rather than adding speculative indexes.

## Live staging evidence captured during MI-2

PetShop staging was inspected read-only before implementation:

- `mypet_runtime`: LOGIN=true; SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS=false.
- runtime database CREATE=false; `mypet` schema CREATE=false; `mypet` schema USAGE=true.
- runtime-owned `mypet` tables=0 and sequences=0.
- direct `anon`/`authenticated` table grants on `mypet`=0.
- PostGIS extension schema=`extensions`.
- V31 is applied successfully and failed Flyway migrations=0.

## Executable contract

`infra/supabase/mi2_core_data_contract.sql` is a read-only live assertion set covering Flyway, runtime privilege, direct-client isolation, PostGIS, geo indexes and validated coordinate constraints.

`scripts/supabase/verify-mi2-core-data.sh` is the repository gate. It also verifies migration continuity, feature boundaries, staging runtime/migration identity separation and absence of direct client domain access.

`.github/workflows/mi2-core-data.yml` independently executes the repository contract, real PostgreSQL Merchant Operations tests, concurrency tests, backend/security verification and whitespace review.

## Deliberate exclusions

MI-2 does not enable PGMQ, pg_cron, Realtime, Edge Functions, Supabase Auth or pgvector. Those features remain subject to explicit later milestone ownership and measured need.

MI-2 introduces no application migration and makes no staging mutation.
