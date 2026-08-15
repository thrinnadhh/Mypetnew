-- Harden the appointment lifecycle to the authoritative DD-006 audit contract.
-- Transition writes are performed transactionally by JdbcAppointmentPersistence
-- so the same invariant is exercised by PostgreSQL and the H2 compatibility suite.

ALTER TABLE mypet.appointment_history
    ALTER COLUMN actor_id DROP NOT NULL,
    ADD COLUMN actor_role VARCHAR(24),
    ADD COLUMN source VARCHAR(48),
    ADD COLUMN idempotency_key VARCHAR(160),
    ADD COLUMN trace_id UUID;

-- Defensive upgrade backfill for any history rows created after V17 and before
-- this migration is applied. Appointment id is a stable trace surrogate for
-- those legacy rows; all new rows receive an explicit request/transition trace.
UPDATE mypet.appointment_history
SET actor_role = CASE WHEN actor_id IS NULL THEN 'SYSTEM' ELSE 'CUSTOMER' END,
    source = CASE WHEN actor_id IS NULL THEN 'SYSTEM_HOLD_EXPIRY' ELSE 'CUSTOMER_API' END,
    idempotency_key = CAST(appointment_id AS VARCHAR) || ':' || to_status,
    trace_id = appointment_id
WHERE actor_role IS NULL
   OR source IS NULL
   OR idempotency_key IS NULL
   OR trace_id IS NULL;

ALTER TABLE mypet.appointment_history
    ALTER COLUMN actor_role SET NOT NULL,
    ALTER COLUMN source SET NOT NULL,
    ALTER COLUMN idempotency_key SET NOT NULL,
    ALTER COLUMN trace_id SET NOT NULL;

ALTER TABLE mypet.appointment_history
    ADD CONSTRAINT chk_appointment_history_actor_role
        CHECK (actor_role IN ('CUSTOMER', 'MERCHANT', 'ADMIN', 'SYSTEM'));

CREATE UNIQUE INDEX uq_appointment_history_transition_replay
    ON mypet.appointment_history(appointment_id, idempotency_key);
