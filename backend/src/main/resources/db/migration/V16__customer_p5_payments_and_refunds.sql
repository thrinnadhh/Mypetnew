ALTER TABLE mypet.product_order
    ADD COLUMN payment_hold_expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE mypet.commerce_quote
    ADD CONSTRAINT ck_commerce_quote_payment_method
    CHECK (payment_method IN ('PAY_ON_FULFILMENT', 'ONLINE_PAYMENT'));

ALTER TABLE mypet.product_order
    ADD CONSTRAINT ck_product_order_payment_method
    CHECK (payment_method IN ('PAY_ON_FULFILMENT', 'ONLINE_PAYMENT'));

CREATE TABLE mypet.payment (
    id UUID PRIMARY KEY,
    reference_type VARCHAR(32) NOT NULL,
    reference_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    provider VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    provider_order_reference VARCHAR(45) NOT NULL,
    provider_session_id VARCHAR(512),
    provider_idempotency_key VARCHAR(64) NOT NULL,
    provider_command_state VARCHAR(24) NOT NULL,
    last_provider_error_code VARCHAR(64),
    reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
    next_reconciliation_at TIMESTAMP WITH TIME ZONE,
    reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
    captured_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_reference_provider UNIQUE (reference_type, reference_id, provider),
    CONSTRAINT uq_payment_provider_order UNIQUE (provider, provider_order_reference),
    CONSTRAINT uq_payment_provider_idempotency UNIQUE (provider, provider_idempotency_key),
    CONSTRAINT ck_payment_reference_type CHECK (reference_type IN ('PRODUCT_ORDER', 'APPOINTMENT')),
    CONSTRAINT ck_payment_provider CHECK (provider = 'CASHFREE'),
    CONSTRAINT ck_payment_status CHECK (status IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'EXPIRED')),
    CONSTRAINT ck_payment_command_state CHECK (provider_command_state IN ('PREPARED', 'CREATED', 'UNKNOWN', 'REJECTED')),
    CONSTRAINT ck_payment_amount CHECK (amount_paise >= 0),
    CONSTRAINT ck_payment_currency CHECK (currency = 'INR'),
    CONSTRAINT ck_payment_reconciliation_attempts CHECK (reconciliation_attempts >= 0)
);

-- A Payment is unique by order/provider, but many accepted client command keys may
-- legitimately converge on that one Payment. Persist each key independently so
-- every accepted retry remains replayable after expiry, cancellation or restart.
CREATE TABLE mypet.payment_initiation_command (
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    payment_id UUID NOT NULL REFERENCES mypet.payment(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, idempotency_key)
);

CREATE INDEX idx_payment_initiation_payment
    ON mypet.payment_initiation_command (payment_id);

CREATE TABLE mypet.payment_history (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES mypet.payment(id),
    from_status VARCHAR(24),
    to_status VARCHAR(24) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    source_identity VARCHAR(160) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_history_source UNIQUE (payment_id, source_identity),
    CONSTRAINT ck_payment_history_to_status CHECK (to_status IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'EXPIRED')),
    CONSTRAINT ck_payment_history_from_status CHECK (
        from_status IS NULL OR from_status IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'EXPIRED')
    )
);

CREATE TABLE mypet.payment_attempt (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES mypet.payment(id),
    provider VARCHAR(24) NOT NULL,
    provider_payment_id VARCHAR(96) NOT NULL,
    outcome VARCHAR(24) NOT NULL,
    payment_amount_paise BIGINT NOT NULL,
    payment_currency VARCHAR(3) NOT NULL,
    provider_payment_time TIMESTAMP WITH TIME ZONE,
    safe_error_code VARCHAR(64),
    safe_error_reason VARCHAR(240),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_attempt_provider_id UNIQUE (provider, provider_payment_id),
    CONSTRAINT ck_payment_attempt_provider CHECK (provider = 'CASHFREE'),
    CONSTRAINT ck_payment_attempt_outcome CHECK (outcome IN ('SUCCESS', 'FAILED', 'USER_DROPPED')),
    CONSTRAINT ck_payment_attempt_amount CHECK (payment_amount_paise >= 0),
    CONSTRAINT ck_payment_attempt_currency CHECK (payment_currency = 'INR')
);

CREATE INDEX idx_payment_attempt_payment
    ON mypet.payment_attempt (payment_id, created_at);

CREATE TABLE mypet.payment_webhook_inbox (
    id UUID PRIMARY KEY,
    provider VARCHAR(24) NOT NULL,
    delivery_identity VARCHAR(160) NOT NULL,
    webhook_version VARCHAR(24) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    provider_order_reference VARCHAR(45) NOT NULL,
    provider_payment_id VARCHAR(96),
    attempt_status VARCHAR(24),
    order_amount_paise BIGINT NOT NULL,
    order_currency VARCHAR(3) NOT NULL,
    payment_amount_paise BIGINT,
    payment_currency VARCHAR(3),
    provider_payment_time TIMESTAMP WITH TIME ZONE,
    provider_event_time TIMESTAMP WITH TIME ZONE,
    payload_sha256 VARCHAR(64) NOT NULL,
    safe_error_code VARCHAR(64),
    safe_error_reason VARCHAR(240),
    processing_status VARCHAR(24) NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_safe_error VARCHAR(240),
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    claim_started_at TIMESTAMP WITH TIME ZONE,
    lease_expires_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_webhook_delivery UNIQUE (provider, delivery_identity),
    CONSTRAINT ck_payment_webhook_provider CHECK (provider = 'CASHFREE'),
    CONSTRAINT ck_payment_webhook_status CHECK (processing_status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
    CONSTRAINT ck_payment_webhook_retry CHECK (retry_count >= 0),
    CONSTRAINT ck_payment_webhook_order_amount CHECK (order_amount_paise >= 0),
    CONSTRAINT ck_payment_webhook_payment_amount CHECK (payment_amount_paise IS NULL OR payment_amount_paise >= 0),
    CONSTRAINT ck_payment_webhook_order_currency CHECK (order_currency = 'INR'),
    CONSTRAINT ck_payment_webhook_payment_currency CHECK (payment_currency IS NULL OR payment_currency = 'INR'),
    CONSTRAINT ck_payment_webhook_processed CHECK (
        (processing_status = 'PROCESSED' AND processed_at IS NOT NULL) OR
        (processing_status <> 'PROCESSED' AND processed_at IS NULL)
    )
);

CREATE TABLE mypet.payment_refund (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES mypet.payment(id),
    status VARCHAR(24) NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    provider_refund_id VARCHAR(40) NOT NULL,
    provider_idempotency_key VARCHAR(64) NOT NULL,
    execution_state VARCHAR(24) NOT NULL,
    reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
    next_reconciliation_at TIMESTAMP WITH TIME ZONE,
    reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
    claim_started_at TIMESTAMP WITH TIME ZONE,
    lease_expires_at TIMESTAMP WITH TIME ZONE,
    last_provider_status VARCHAR(24),
    last_safe_error_code VARCHAR(64),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_payment_refund_payment UNIQUE (payment_id),
    CONSTRAINT uq_payment_refund_provider_id UNIQUE (provider_refund_id),
    CONSTRAINT uq_payment_refund_provider_idempotency UNIQUE (provider_idempotency_key),
    CONSTRAINT ck_payment_refund_status CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
    CONSTRAINT ck_payment_refund_execution CHECK (execution_state IN ('PREPARED', 'SUBMITTED', 'UNKNOWN', 'TERMINAL')),
    CONSTRAINT ck_payment_refund_amount CHECK (amount_paise >= 0),
    CONSTRAINT ck_payment_refund_currency CHECK (currency = 'INR'),
    CONSTRAINT ck_payment_refund_attempts CHECK (reconciliation_attempts >= 0)
);

CREATE TABLE mypet.payment_refund_history (
    id UUID PRIMARY KEY,
    refund_id UUID NOT NULL REFERENCES mypet.payment_refund(id),
    from_status VARCHAR(24),
    to_status VARCHAR(24) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    source_identity VARCHAR(160) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_refund_history_source UNIQUE (refund_id, source_identity),
    CONSTRAINT ck_refund_history_to_status CHECK (to_status IN ('PENDING', 'SUCCESS', 'FAILED')),
    CONSTRAINT ck_refund_history_from_status CHECK (
        from_status IS NULL OR from_status IN ('PENDING', 'SUCCESS', 'FAILED')
    )
);

CREATE INDEX idx_product_order_payment_expiry
    ON mypet.product_order (payment_hold_expires_at, status, payment_status)
    WHERE payment_method = 'ONLINE_PAYMENT';
CREATE INDEX idx_payment_reconciliation
    ON mypet.payment (next_reconciliation_at, updated_at)
    WHERE reconciliation_required = TRUE;
CREATE INDEX idx_payment_webhook_claim
    ON mypet.payment_webhook_inbox (processing_status, lease_expires_at, received_at);
CREATE INDEX idx_payment_refund_retry
    ON mypet.payment_refund (next_reconciliation_at, lease_expires_at, updated_at)
    WHERE status <> 'SUCCESS';
