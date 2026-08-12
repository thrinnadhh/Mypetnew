CREATE TABLE mypet.pos_customer_association_challenge (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pos_association_customer_idempotency UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX idx_pos_association_outlet_expiry
    ON mypet.pos_customer_association_challenge(outlet_id, expires_at);
