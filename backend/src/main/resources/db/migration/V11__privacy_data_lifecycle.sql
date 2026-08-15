ALTER TABLE mypet.identity_account ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE mypet.customer_profile (
    account_id UUID PRIMARY KEY REFERENCES mypet.identity_account(id),
    display_name VARCHAR(120),
    email VARCHAR(254),
    adult_eligibility_attested_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (display_name IS NULL OR LENGTH(display_name) BETWEEN 1 AND 120),
    CHECK (email IS NULL OR LENGTH(email) BETWEEN 3 AND 254)
);

CREATE TABLE mypet.privacy_consent (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    purpose VARCHAR(64) NOT NULL,
    notice_version VARCHAR(64) NOT NULL,
    source VARCHAR(32) NOT NULL,
    proof_metadata VARCHAR(240) NOT NULL,
    granted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    withdrawn_at TIMESTAMP WITH TIME ZONE,
    CHECK (purpose IN (
        'LOCATION', 'NOTIFICATIONS', 'MARKETING', 'PERSONALISATION',
        'PRODUCT_ANALYTICS', 'RECURRING_ORDER_REMINDERS'
    )),
    CHECK (source IN ('CUSTOMER_APP', 'CUSTOMER_WEB', 'SUPPORT_ASSISTED')),
    CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);

CREATE TABLE mypet.privacy_rights_request (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    request_type VARCHAR(32) NOT NULL,
    status VARCHAR(48) NOT NULL,
    request_details VARCHAR(1000),
    lawful_rejection_reason VARCHAR(500),
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL,
    identity_verified_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK (request_type IN ('ACCESS', 'CORRECTION', 'ERASURE', 'GRIEVANCE', 'NOMINATION')),
    CHECK (status IN ('REQUESTED', 'IDENTITY_VERIFIED', 'IN_REVIEW', 'COMPLETED', 'REJECTED_WITH_LAWFUL_REASON')),
    CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE TABLE mypet.account_deletion_request (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL UNIQUE REFERENCES mypet.identity_account(id),
    status VARCHAR(48) NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL,
    direct_identifiers_erased_at TIMESTAMP WITH TIME ZONE,
    legal_retention_review_due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    backup_suppression_until TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK (status IN ('REQUESTED', 'IDENTITY_DISABLED', 'DIRECT_IDENTIFIERS_ERASED', 'COMPLETED', 'LEGAL_HOLD'))
);

CREATE TABLE mypet.deleted_identity_tombstone (
    account_id UUID PRIMARY KEY REFERENCES mypet.identity_account(id),
    deleted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    backup_suppression_until TIMESTAMP WITH TIME ZONE NOT NULL,
    reason_code VARCHAR(48) NOT NULL
);

CREATE TABLE mypet.security_incident (
    id UUID PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    status VARCHAR(48) NOT NULL,
    incident_detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    became_aware_at TIMESTAMP WITH TIME ZONE,
    cert_in_deadline TIMESTAMP WITH TIME ZONE,
    dpdp_board_deadline TIMESTAMP WITH TIME ZONE,
    affected_users_notified_at TIMESTAMP WITH TIME ZONE,
    cert_in_reported_at TIMESTAMP WITH TIME ZONE,
    board_reported_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CHECK (status IN (
        'DETECTED', 'TRIAGED', 'REPORTABLE_CERTIN', 'DPDP_PERSONAL_DATA_BREACH',
        'CONTAINED', 'ERADICATED', 'RECOVERED', 'POSTMORTEM_COMPLETE'
    ))
);

CREATE INDEX idx_privacy_consent_customer_purpose
    ON mypet.privacy_consent(customer_id, purpose, granted_at);
CREATE INDEX idx_privacy_rights_customer_time
    ON mypet.privacy_rights_request(customer_id, requested_at);
CREATE INDEX idx_security_incident_deadlines
    ON mypet.security_incident(status, cert_in_deadline, dpdp_board_deadline);
