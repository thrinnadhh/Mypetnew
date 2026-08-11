# Sprint 1 recovery and forward-fix runbook

## Scope

This runbook covers the Sprint 1 private application schema, API, client rollback, notification replay, and evidence preservation. It is a rehearsal template until exercised against an isolated Supabase staging project.

## Before a release

1. Record the commit, build IDs, Flyway version, Supabase project reference, Firebase project/app IDs, and secret versions without copying secret values.
2. Confirm a current database backup/PITR point and perform the scheduled isolated restore drill.
3. Run `./scripts/verify.sh`, Supabase boundary tests, and the connected staging smoke flow.
4. Confirm notification outbox depth is zero or understood and that invalid-token/dead-letter alerts have owners.

## Failure response

1. Stop rollout and preserve trace IDs, Flyway history, metrics, and safe provider receipts.
2. Disable affected commands or notification dispatch through reviewed environment controls; never mutate business state from a push callback.
3. Roll clients/backend back only when the previous version is schema-compatible. Database changes are corrected with a reviewed forward Flyway migration; never edit or delete applied migrations.
4. Replay only durable outbox rows through the idempotent provider boundary. Replaying must not repeat the order, inventory, POS, or loyalty transition.
5. Reconcile orders, inventory movements, POS sales, loyalty sources, notification logical IDs, and inbox rows before resuming rollout.

## Restore drill

Restore the backup into a new isolated project, rotate credentials, apply any pending Flyway migrations, then run the full walking skeleton. Verify aggregate totals, histories, idempotency records, and notification projections. Confirm old credentials fail and private objects remain private. Store the redacted report under the immutable release evidence; until this is exercised, S1-OPS-009 and S1-SUP-012 remain `NOT RUN`.
