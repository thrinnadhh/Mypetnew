-- V17 intentionally constrained the original appointment payment columns to the
-- Sprint-1 PAY_AT_PROVIDER contract. Do not rewrite released migration history.
-- V18 adds canonical v2 payment projection columns while leaving the legacy
-- columns intact for rollback/read compatibility.
ALTER TABLE mypet.appointment
    ADD COLUMN payment_mode VARCHAR(32) NOT NULL DEFAULT 'PAY_AT_PROVIDER';

ALTER TABLE mypet.appointment
    ADD COLUMN payment_state VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED';

ALTER TABLE mypet.appointment
    ADD CONSTRAINT ck_appointment_payment_mode_v2
    CHECK (payment_mode IN ('PAY_AT_PROVIDER', 'ONLINE_PAYMENT'));

ALTER TABLE mypet.appointment
    ADD CONSTRAINT ck_appointment_payment_state_v2
    CHECK (payment_state IN ('NOT_REQUIRED','PENDING','PAID','FAILED','EXPIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED'));

CREATE INDEX idx_appointment_payment_projection
    ON mypet.appointment(payment_mode, payment_state, status, hold_expires_at);

CREATE INDEX idx_payment_appointment_reference
    ON mypet.payment(reference_type, reference_id, status, updated_at);

-- Product-order refund workers take ProductOrder locks before Payment/Refund
-- locks. Appointment refunds therefore use a dedicated table so the mature
-- product worker never interprets an appointment UUID as an order UUID.
CREATE TABLE mypet.appointment_payment_refund (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL UNIQUE REFERENCES mypet.payment(id),
    appointment_id UUID NOT NULL REFERENCES mypet.appointment(id),
    status VARCHAR(16) NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    provider_refund_id VARCHAR(64) NOT NULL UNIQUE,
    provider_idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    execution_state VARCHAR(16) NOT NULL,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    safe_error_code VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('PENDING','SUCCESS','FAILED')),
    CHECK (execution_state IN ('PREPARED','SUBMITTED','UNKNOWN','TERMINAL')),
    CHECK (amount_paise >= 0),
    CHECK (currency = 'INR'),
    CHECK (attempt_count >= 0)
);

CREATE INDEX idx_appointment_refund_worker
    ON mypet.appointment_payment_refund(status, next_attempt_at, created_at);
