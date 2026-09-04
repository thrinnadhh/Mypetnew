# MI-3 — Queue / Async Infrastructure Hardening

## Objective

MI-3 certifies and hardens MyPetNew's existing PostgreSQL transactional outbox/inbox architecture after MI-2. It intentionally does not introduce a second queue authority when the current design already provides atomic publication, durable retries, consumer dedupe and dead-letter handling.

## Repository truth

The platform already has:

- `mypet.outbox_event` written in the same transaction as business changes;
- `mypet.inbox_event` keyed by `(consumer_name, source_event_id)` for durable consumer dedupe;
- `mypet.dead_letter` for terminal failures;
- `notification_attempt` with retry timing and stale-claim recovery;
- `FOR UPDATE ... SKIP LOCKED` notification claiming;
- notification retry and dead-letter transitions;
- `idx_outbox_claim` and `idx_notification_attempt_delivery` claim indexes;
- unique inventory movement publication protection.

Live PetShop staging was inspected read-only before MI-3. `outbox_event` and `notification_attempt` currently contain no rows, and `pgmq` is not installed.

## V32 forward migration

`V32__async_delivery_state_hardening.sql` adds and validates explicit lifecycle constraints for:

- `outbox_event.status`: `PENDING`, `PROCESSING`, `RETRY`, `DELIVERED`, `DEAD_LETTER`;
- `notification_attempt.status`: the same bounded lifecycle set.

Both constraints use the `NOT VALID` then `VALIDATE CONSTRAINT` pattern so an upgrade detects incompatible historical data before claiming success.

## Failure-mode evidence

`MI3AsyncInfrastructurePostgresContractTest` runs against real PostgreSQL and:

1. validates the new constraints exist and are validated;
2. attempts an invalid outbox state and requires PostgreSQL rejection;
3. disables FK triggers only for the notification-attempt probe so rejection must come from the status CHECK rather than an unrelated foreign key;
4. verifies the async claim/dedupe indexes remain present;
5. verifies the inbox composite primary key remains intact.

## Queue authority decision

PGMQ remains **deferred**. Introducing it now would create a competing queue abstraction beside an already transactionally coupled outbox/inbox. The MI-3 repository gate fails if PGMQ appears in production Kotlin or Flyway migrations without a future explicit architecture decision.

## Security and compatibility

- No client receives queue/database authority.
- Spring Boot remains async worker authority.
- No historical migration is edited.
- No API contract changes.
- No staging mutation is performed by this PR.
