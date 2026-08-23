ALTER TABLE mypet.dispatch_job ADD COLUMN pickup_pin VARCHAR(8) NOT NULL DEFAULT '1234';
ALTER TABLE mypet.dispatch_job ADD COLUMN delivery_pin VARCHAR(8) NOT NULL DEFAULT '5678';
ALTER TABLE mypet.dispatch_job ADD COLUMN pickup_idempotency_key VARCHAR(128);
ALTER TABLE mypet.dispatch_job ADD COLUMN pickup_fingerprint VARCHAR(64);
ALTER TABLE mypet.dispatch_job ADD COLUMN pickup_proof_payload TEXT;
ALTER TABLE mypet.dispatch_job ADD COLUMN delivery_idempotency_key VARCHAR(128);
ALTER TABLE mypet.dispatch_job ADD COLUMN delivery_fingerprint VARCHAR(64);
ALTER TABLE mypet.dispatch_job ADD COLUMN delivery_proof_payload TEXT;

CREATE TABLE mypet.captain_onboarding (
    captain_id UUID PRIMARY KEY REFERENCES mypet.identity_account(id),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    full_name VARCHAR(120),
    dob VARCHAR(20),
    emergency_contact VARCHAR(20),
    address VARCHAR(240),
    city VARCHAR(120),
    pincode VARCHAR(6),
    identity_type VARCHAR(24),
    identity_number_masked VARCHAR(32),
    identity_number_hash VARCHAR(64),
    driving_license_number VARCHAR(64),
    license_expiry VARCHAR(20),
    license_document_ref UUID,
    vehicle_type VARCHAR(24),
    registration_number VARCHAR(32),
    vehicle_model VARCHAR(64),
    vehicle_colour VARCHAR(32),
    rc_document_ref UUID,
    bank_account_holder VARCHAR(120),
    bank_account_number_masked VARCHAR(32),
    bank_account_number_hash VARCHAR(64),
    bank_ifsc VARCHAR(20),
    bank_name VARCHAR(120),
    consent_agreement BOOLEAN NOT NULL DEFAULT FALSE,
    consent_privacy BOOLEAN NOT NULL DEFAULT FALSE,
    consent_location BOOLEAN NOT NULL DEFAULT FALSE,
    consent_safety BOOLEAN NOT NULL DEFAULT FALSE,
    consent_settlement BOOLEAN NOT NULL DEFAULT FALSE,
    step_completed INTEGER NOT NULL DEFAULT 1,
    submit_idempotency_key VARCHAR(128),
    rejection_reason VARCHAR(240),
    submitted_at TIMESTAMP WITH TIME ZONE,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'))
);

CREATE TABLE mypet.captain_support_ticket (
    id UUID PRIMARY KEY,
    captain_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    category VARCHAR(32) NOT NULL,
    subject VARCHAR(160) NOT NULL,
    description VARCHAR(2000) NOT NULL,
    job_id UUID REFERENCES mypet.dispatch_job(id),
    order_reference VARCHAR(64),
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('OPEN', 'RESOLVED', 'CLOSED'))
);

CREATE INDEX idx_captain_support_ticket_captain
    ON mypet.captain_support_ticket(captain_id, created_at DESC);

CREATE INDEX idx_dispatch_job_captain_delivered
    ON mypet.dispatch_job(assigned_captain_id, status, delivered_at);
