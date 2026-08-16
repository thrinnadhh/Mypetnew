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
    CHECK (payment_state IN ('NOT_REQUIRED','PENDING','PAID','FAILED','EXPIRED','REFUND_PENDING','REFUNDED'));

CREATE INDEX idx_appointment_payment_projection
    ON mypet.appointment(payment_mode, payment_state, status, hold_expires_at);

CREATE INDEX idx_payment_appointment_reference
    ON mypet.payment(reference_type, reference_id, status, updated_at);
