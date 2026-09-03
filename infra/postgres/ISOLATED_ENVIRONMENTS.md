# Isolated PostgreSQL Environments

## Purpose

MyPetNew uses free, disposable PostgreSQL environments for development and pull-request certification. Supabase `PetShop` remains the protected staging platform; ordinary PRs and autonomous development must not write test data into staging.

This design preserves the earlier Supabase hardening work: Spring Boot remains the business/auth authority, backend Flyway SQL remains the single schema history, Supabase Storage/runtime-role/drift controls remain intact, and PostGIS remains part of the canonical PostgreSQL runtime.

## Environment ladder

1. H2 — fast unit tests only where PostgreSQL semantics are irrelevant.
2. Testcontainers PostgreSQL — transaction, locking and concurrency contracts.
3. GitHub Actions ephemeral PostGIS/PostgreSQL 17 — clean PR runtime certification.
4. Remote Mac isolated Docker PostGIS/PostgreSQL 17 — API, app and emulator integration.
5. Supabase `PetShop` — staging drift and staging-device certification only.
6. Future production Supabase project — production only.

## Pull-request isolation

`.github/workflows/postgres-isolation.yml` starts a disposable `postgis/postgis:17-3.5-alpine` service on the GitHub runner. It:

- proves the `mypet` schema is empty before startup;
- generates runtime-only application secrets;
- boots the exact Spring backend against the fresh database;
- lets Spring Flyway apply the complete forward-only migration chain;
- requires `/actuator/health` to report `UP`;
- verifies live Flyway history equals repository HEAD with zero failed migrations;
- proves identity/session/order/POS/payment tables contain no copied staging data;
- runs the real PostgreSQL Merchant Operations and concurrency suites;
- uploads only non-secret evidence.

The database disappears with the GitHub runner. No Supabase access token, database password, preview branch, or branch compute is required.

## Remote Mac isolation

Use one named environment per worktree/sprint:

```bash
./scripts/dev/isolated-postgres-env.sh create mi1
./scripts/dev/isolated-postgres-env.sh migrate mi1
./scripts/dev/isolated-postgres-env.sh boot mi1
./scripts/dev/isolated-postgres-env.sh status mi1
```

Or run migration + backend health certification together:

```bash
./scripts/dev/isolated-postgres-env.sh certify mi1
```

Cleanup is targeted:

```bash
./scripts/dev/isolated-postgres-env.sh stop mi1
./scripts/dev/isolated-postgres-env.sh destroy mi1
```

The script never runs a global Docker prune and never resets Git. Runtime credentials are generated locally, stored under ignored `.mypet-env/<name>/` with restrictive permissions, and are not printed.

On Apple Silicon, the official PostGIS image may run under Docker Desktop's amd64 emulation. We intentionally prefer the official image over an unreviewed third-party multi-architecture database image.

## Migration ownership

The only application schema authority is:

`backend/src/main/resources/db/migration/V*__*.sql`

Do not create a second application migration history under `supabase/migrations`. `scripts/supabase/verify-feature-boundaries.sh` fails CI if such a history appears.

## Supabase staging policy

Use `PetShop` only after local/PR certification for:

- live Flyway drift verification;
- Supabase Storage integration;
- runtime-role/security checks;
- PostGIS/staging query certification;
- staging HTTP/device acceptance.

Do not use staging as a scratch database for ordinary tests, AI-agent experiments, or parallel worktrees.

## Failure policy

A green unit suite is not enough. Isolation certification must fail when the database is not fresh, Flyway drifts, backend startup fails, transactional data appears unexpectedly, or PostgreSQL concurrency contracts fail.

A GREEN TEST SUITE IS NOT EVIDENCE THAT THE IMPLEMENTATION IS CORRECT UNLESS THE TEST EXERCISES THE FAILURE MODE BEING CERTIFIED.
