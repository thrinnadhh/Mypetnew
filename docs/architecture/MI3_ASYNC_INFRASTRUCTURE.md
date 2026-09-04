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
- notification retry, invalid-token and dead-letter transitions;
- `idx_outbox_claim` and `idx_notification_attempt_delivery` claim indexes;
- unique inventory movement publication protection.

Live PetShop staging was inspected read-only before MI-3. `outbox_event` and `notification_attempt` contained no rows, and `pgmq` was not installed.

## V32 lifecycle hardening and V33 forward repair

`V32__async_delivery_state_hardening.sql` introduced explicit lifecycle constraints for the outbox and notification-attempt tables.

A post-merge source audit found that production notification delivery intentionally writes `notification_attempt.status = 'INVALID'` when a push token is rejected. V32 had omitted that legitimate terminal state. Because V32 was already merged, it is not edited in place.

`V33__notification_invalid_terminal_state.sql` is the forward-only repair. The effective lifecycle sets are:

- `outbox_event.status`: `PENDING`, `PROCESSING`, `RETRY`, `DELIVERED`, `DEAD_LETTER`;
- `notification_attempt.status`: `PENDING`, `PROCESSING`, `RETRY`, `DELIVERED`, `INVALID`, `DEAD_LETTER`.

The V33 constraint also uses `NOT VALID` followed by `VALIDATE CONSTRAINT` so incompatible historical data is detected before an upgrade is considered successful.

## Failure-mode evidence

`MI3AsyncInfrastructurePostgresContractTest` runs against real PostgreSQL and:

1. validates the lifecycle constraints exist and are validated;
2. proves `INVALID` is accepted for notification attempts;
3. attempts an invalid outbox state and requires PostgreSQL rejection;
4. disables FK triggers only for the notification-attempt probes so status behavior is isolated from unrelated foreign keys;
5. proves an unknown notification status is rejected;
6. verifies the async claim/dedupe indexes remain present;
7. verifies the inbox composite primary key remains intact.

## Queue authority decision

PGMQ remains **deferred**. Introducing it now would create a competing queue abstraction beside an already transactionally coupled outbox/inbox. The MI-3 repository gate fails if PGMQ appears in production Kotlin or Flyway migrations without a future explicit architecture decision.

## Security and compatibility

- No client receives queue/database authority.
- Spring Boot remains async worker authority.
- No historical migration is edited.
- No API contract changes.
- Staging DDL remains separately controlled.
