# MI-4 — Scheduled Infrastructure / Multi-Replica Safety

## Objective

MI-4 makes every production Spring scheduled entry point safe when the backend runs with multiple replicas. Spring Boot remains scheduler authority; PostgreSQL supplies only cluster-wide ownership through advisory locks.

## Repository truth

Before MI-4, the backend had nine `@Scheduled` entry points across payment lifecycle, delivery recovery/retry, recurring orders, catalog-media cleanup and notification delivery. Their delegated business operations were already idempotent, claim-based or retry-safe, but scheduler invocation itself had no cluster-wide single-owner guard.

## Architecture

`PostgresScheduledJobLock` uses a dedicated JDBC connection and PostgreSQL session-level advisory locks:

- `pg_try_advisory_lock(bigint)` is non-blocking; a competing replica skips the current invocation instead of waiting;
- `pg_advisory_unlock(bigint)` runs in `finally` after successful or failed job execution;
- session ownership means connection/JVM loss releases the lock automatically;
- deterministic SHA-256-derived 64-bit keys give each job a stable namespace;
- different scheduled jobs use different keys and therefore remain independently runnable.

The lock does not wrap business work in one database transaction. Existing service-level transactions, idempotency keys, `SKIP LOCKED` claims and retry semantics remain authoritative.

## Guarded production jobs

1. payment webhook inbox processing
2. payment reconciliation
3. payment expiry
4. payment refunds
5. ready-delivery recovery
6. dispatch retry
7. recurring-order processing
8. catalog-media cleanup
9. notification delivery

## Failure-mode evidence

`MI4ScheduledInfrastructurePostgresContractTest` runs against real PostgreSQL/PostGIS and proves:

- two replicas cannot run the same scheduled job concurrently;
- the skipped replica does not execute its task body;
- ownership is released after normal completion;
- ownership is released after task failure;
- different scheduled jobs do not block each other;
- deterministic job names map to stable, distinct advisory keys.

The repository gate `verify-mi4-scheduled-infrastructure.sh` additionally fails if the production `@Scheduled` count and guarded invocation count diverge, if any expected job guard disappears, if blocking advisory acquisition is introduced, or if existing Supabase/PostgreSQL feature boundaries regress.

## Deliberate non-goals

- no `pg_cron` application scheduling;
- no Supabase Realtime scheduling authority;
- no new queue authority;
- no schema migration is required for scheduler locks;
- no client application receives database or scheduling authority.

## Certification gate

MI-4 is complete only after the dedicated workflow proves the repository guard, real PostgreSQL lock semantics, existing PostgreSQL concurrency suite, backend/security baseline and whitespace gate, and the full exact-head pull-request matrix is green with no review blocker.
