ALTER TABLE mypet.provider_outlet
    ADD COLUMN dispatch_latitude DOUBLE PRECISION,
    ADD COLUMN dispatch_longitude DOUBLE PRECISION,
    ADD CONSTRAINT chk_provider_dispatch_coordinates CHECK (
        (dispatch_latitude IS NULL AND dispatch_longitude IS NULL)
        OR (
            dispatch_latitude BETWEEN -90.0 AND 90.0
            AND dispatch_longitude BETWEEN -180.0 AND 180.0
        )
    );

ALTER TABLE mypet.commerce_quote
    ADD COLUMN delivery_address_id UUID,
    ADD COLUMN delivery_recipient_name VARCHAR(120),
    ADD COLUMN delivery_phone_number VARCHAR(16),
    ADD COLUMN delivery_line1 VARCHAR(240),
    ADD COLUMN delivery_line2 VARCHAR(240),
    ADD COLUMN delivery_city VARCHAR(120),
    ADD COLUMN delivery_state VARCHAR(120),
    ADD COLUMN delivery_pincode VARCHAR(6),
    ADD COLUMN delivery_eta_minutes INTEGER,
    ADD CONSTRAINT chk_quote_delivery_snapshot CHECK (
        (fulfilment_mode <> 'MYPET_CAPTAIN_DELIVERY')
        OR (
            delivery_address_id IS NOT NULL
            AND delivery_recipient_name IS NOT NULL
            AND delivery_phone_number IS NOT NULL
            AND delivery_line1 IS NOT NULL
            AND delivery_city IS NOT NULL
            AND delivery_state IS NOT NULL
            AND delivery_pincode IS NOT NULL
            AND delivery_eta_minutes BETWEEN 1 AND 240
        )
    );

CREATE TABLE mypet.captain_delivery_state (
    captain_id UUID PRIMARY KEY REFERENCES mypet.identity_account(id),
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    online BOOLEAN NOT NULL DEFAULT FALSE,
    busy BOOLEAN NOT NULL DEFAULT FALSE,
    last_location_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mypet.dispatch_job (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL UNIQUE REFERENCES mypet.product_order(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    origin_latitude DOUBLE PRECISION NOT NULL,
    origin_longitude DOUBLE PRECISION NOT NULL,
    status VARCHAR(24) NOT NULL,
    assigned_captain_id UUID REFERENCES mypet.identity_account(id),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    failure_reason VARCHAR(80),
    assigned_at TIMESTAMP WITH TIME ZONE,
    picked_up_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (origin_latitude BETWEEN -90.0 AND 90.0),
    CHECK (origin_longitude BETWEEN -180.0 AND 180.0),
    CHECK (attempt_count >= 0),
    CHECK (status IN ('SEARCHING','OFFERED','ASSIGNED','PICKED_UP','DELIVERED','FAILED'))
);

CREATE TABLE mypet.dispatch_offer (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES mypet.dispatch_job(id),
    captain_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    offer_rank INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL,
    offered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    responded_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_dispatch_job_captain UNIQUE (job_id, captain_id),
    CONSTRAINT uq_dispatch_job_rank UNIQUE (job_id, offer_rank),
    CHECK (offer_rank > 0),
    CHECK (status IN ('PENDING','ACCEPTED','REJECTED','TIMED_OUT')),
    CHECK (expires_at > offered_at)
);

CREATE INDEX idx_dispatch_job_active
    ON mypet.dispatch_job(status, updated_at, id);

CREATE INDEX idx_dispatch_offer_captain_pending
    ON mypet.dispatch_offer(captain_id, status, expires_at, offered_at);

CREATE INDEX idx_captain_delivery_eligibility
    ON mypet.captain_delivery_state(approved, online, busy, last_location_at);
