-- Harden the appointment lifecycle to the authoritative DD-006 audit contract.
-- Every transition must retain actor/source/time/idempotency/trace evidence, and
-- automatic hold expiry must be audited rather than silently mutating state.

ALTER TABLE mypet.appointment_history
    ALTER COLUMN actor_id DROP NOT NULL,
    ADD COLUMN actor_role VARCHAR(24),
    ADD COLUMN source VARCHAR(48),
    ADD COLUMN idempotency_key VARCHAR(160),
    ADD COLUMN trace_id UUID;

CREATE OR REPLACE FUNCTION mypet.normalize_appointment_history_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.actor_role IS NULL THEN
        NEW.actor_role := CASE WHEN NEW.actor_id IS NULL THEN 'SYSTEM' ELSE 'CUSTOMER' END;
    END IF;

    IF NEW.source IS NULL THEN
        NEW.source := CASE WHEN NEW.actor_id IS NULL THEN 'SYSTEM_HOLD_EXPIRY' ELSE 'CUSTOMER_API' END;
    END IF;

    IF NEW.idempotency_key IS NULL THEN
        -- The current appointment state machine is monotonic for these customer
        -- transitions, so appointment + target-state is the stable replay key.
        NEW.idempotency_key := NEW.appointment_id::text || ':' || NEW.to_status;
    END IF;

    IF NEW.trace_id IS NULL THEN
        NEW.trace_id := gen_random_uuid();
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_appointment_history_audit_defaults
BEFORE INSERT ON mypet.appointment_history
FOR EACH ROW
EXECUTE FUNCTION mypet.normalize_appointment_history_audit();

-- Backfill defensively for any rows created while V17 was exercised in an
-- ephemeral/staging database before this hardening migration is applied.
UPDATE mypet.appointment_history
SET actor_role = CASE WHEN actor_id IS NULL THEN 'SYSTEM' ELSE 'CUSTOMER' END,
    source = CASE WHEN actor_id IS NULL THEN 'SYSTEM_HOLD_EXPIRY' ELSE 'CUSTOMER_API' END,
    idempotency_key = appointment_id::text || ':' || to_status,
    trace_id = gen_random_uuid()
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

CREATE OR REPLACE FUNCTION mypet.audit_appointment_hold_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'HOLD' AND NEW.status = 'HOLD_EXPIRED' THEN
        INSERT INTO mypet.appointment_history (
            id,
            appointment_id,
            from_status,
            to_status,
            actor_id,
            actor_role,
            source,
            reason,
            idempotency_key,
            trace_id,
            occurred_at
        ) VALUES (
            gen_random_uuid(),
            NEW.id,
            'HOLD',
            'HOLD_EXPIRED',
            NULL,
            'SYSTEM',
            'SYSTEM_HOLD_EXPIRY',
            'Appointment hold expired',
            NEW.id::text || ':HOLD_EXPIRED',
            gen_random_uuid(),
            NEW.updated_at
        )
        ON CONFLICT (appointment_id, idempotency_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_appointment_hold_expiry_audit
AFTER UPDATE OF status ON mypet.appointment
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION mypet.audit_appointment_hold_expiry();
