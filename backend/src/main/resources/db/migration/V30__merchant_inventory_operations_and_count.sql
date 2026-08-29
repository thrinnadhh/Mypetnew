-- M8: canonical inventory count sessions, count lines, and outlet transfers with transfer conservation
CREATE TABLE mypet.inventory_count_session (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    cutoff_sequence_number BIGINT NOT NULL DEFAULT 0,
    cutoff_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id UUID NOT NULL,
    submit_idempotency_key VARCHAR(128) NULL,
    reconciliation_summary TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT uq_inventory_count_session_submit UNIQUE (organization_id, outlet_id, submit_idempotency_key),
    CHECK (status IN ('OPEN', 'SUBMITTED', 'REVIEW_REQUIRED', 'CANCELLED')),
    CHECK (cutoff_sequence_number >= 0)
);

CREATE INDEX idx_inventory_count_session_outlet
    ON mypet.inventory_count_session (organization_id, outlet_id, status, created_at DESC);

CREATE TABLE mypet.inventory_count_line (
    session_id UUID NOT NULL REFERENCES mypet.inventory_count_session(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    counted_quantity INTEGER NOT NULL,
    cutoff_on_hand INTEGER NOT NULL,
    reconciled_delta INTEGER NULL,
    resulting_on_hand INTEGER NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, listing_id),
    CHECK (counted_quantity >= 0)
);

CREATE INDEX idx_inventory_count_line_listing
    ON mypet.inventory_count_line (listing_id);

CREATE TABLE mypet.inventory_transfer (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    source_outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    destination_outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    source_listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    destination_listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    quantity INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    actor_id UUID NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    source_movement_id UUID NOT NULL REFERENCES mypet.inventory_movement(id),
    destination_movement_id UUID NOT NULL REFERENCES mypet.inventory_movement(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_transfer_idempotency UNIQUE (organization_id, actor_id, idempotency_key),
    CONSTRAINT chk_transfer_outlets_distinct CHECK (source_outlet_id <> destination_outlet_id),
    CHECK (quantity > 0),
    CHECK (status IN ('COMPLETED', 'CANCELLED', 'FAILED'))
);

CREATE INDEX idx_inventory_transfer_org_outlet
    ON mypet.inventory_transfer (organization_id, source_outlet_id, destination_outlet_id, created_at DESC);
