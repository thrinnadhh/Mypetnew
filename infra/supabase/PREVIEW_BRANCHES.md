# Supabase Preview Branches

## Purpose

MyPetNew uses Supabase preview branches as disposable PostgreSQL environments for pull-request certification. Spring Boot and Flyway remain the database authority; the repository does not duplicate backend Flyway migrations into `supabase/migrations`.

## Safety model

- Parent project: `PetShop` (`gxxmbmcezyuqwywblzlh`).
- Preview branches must be created without production/staging data.
- Preview CI rejects credentials that resolve to the parent project ref.
- Preview CI refuses to baseline an existing schema. The complete forward-only Flyway chain must build the branch successfully.
- Preview certification fails if identity, session, order, POS-sale, or payment rows are present after migration.
- No client application receives database credentials or a Supabase service-role credential.

## One-time Supabase setup

In Supabase Project Settings > Integrations:

1. Authorize the GitHub repository `thrinnadhh/Mypetnew`.
2. Set the working directory to `.` so Supabase can discover `supabase/config.toml`.
3. Enable Automatic Branching.
4. Keep production-data cloning disabled for preview branches.

Supabase branching may incur plan/compute charges. Enable it only after the account owner has reviewed the displayed branch cost.

## One-time GitHub setup

Add repository secret:

- `SUPABASE_ACCESS_TOKEN`: fine-grained/personal token allowed to read branch environments for the PetShop project.

After Supabase Automatic Branching is enabled and cost has been approved, add repository variable:

- `SUPABASE_PREVIEW_ENABLED=true`

Until this variable is set, pull-request preview certification is intentionally skipped. `workflow_dispatch` remains available for explicit testing.

## Pull-request flow

1. A GitHub branch/PR is opened.
2. Supabase Automatic Branching creates an isolated preview project for the Git branch.
3. `.github/workflows/supabase-preview.yml` waits for the preview project to become healthy.
4. The workflow requests branch connection metadata with Supabase CLI `2.116.0`.
5. `prepare-preview-branch-env.mjs` validates that the database is a direct Supabase preview host and is not the parent project.
6. `migrate-preview-branch.sh` applies the canonical backend Flyway migration chain using Flyway `12.4.0`.
7. `verify-live-drift.sh` proves the branch's Flyway history matches repository HEAD.
8. `verify-preview-isolation.sh` proves no user/transaction data was copied into the preview database.
9. A small evidence artifact records the Git SHA, preview ref, parent ref, Flyway image, and latest migration version. No credentials are written to the artifact.
10. Supabase deletes ephemeral preview branches when their PR lifecycle ends.

## Migration ownership

Backend migration source of truth:

`backend/src/main/resources/db/migration/V*__*.sql`

Do not copy these migrations into `supabase/migrations`. A second migration history would create drift and make rollback/certification ambiguous.

## Failure policy

A preview run must fail closed when:

- Supabase branch credentials are unavailable;
- the resolved branch ref equals the parent project ref;
- the database host is a pooler/non-direct host when direct-host identity cannot be proven;
- Flyway migration or validation fails;
- repository/live Flyway versions differ;
- the branch contains identity/session/order/POS/payment data.

Do not bypass these checks to obtain a green CI result.
