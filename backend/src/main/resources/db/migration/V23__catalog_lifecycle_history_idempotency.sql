-- M2: durable catalog mutation history and retry receipts.
-- V1 already established catalog_listing.active and catalog_listing.version as canonical lifecycle/version fields.

CREATE TABLE mypet.catalog_listing_history (
    id UUID PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    listing_version BIGINT NOT NULL,
    mutation_type VARCHAR(24) NOT NULL,
    actor_id UUID NOT NULL,
    old_name VARCHAR(160),
    new_name VARCHAR(160) NOT NULL,
    old_mrp_paise BIGINT,
    new_mrp_paise BIGINT NOT NULL,
    old_selling_price_paise BIGINT,
    new_selling_price_paise BIGINT NOT NULL,
    old_category VARCHAR(80),
    new_category VARCHAR(80) NOT NULL,
    old_brand VARCHAR(100),
    new_brand VARCHAR(100),
    old_description VARCHAR(2000),
    new_description VARCHAR(2000),
    old_pet_type VARCHAR(40),
    new_pet_type VARCHAR(40),
    old_life_stage VARCHAR(40),
    new_life_stage VARCHAR(40),
    old_pack_label VARCHAR(80),
    new_pack_label VARCHAR(80),
    old_sku VARCHAR(80),
    new_sku VARCHAR(80),
    old_active BOOLEAN,
    new_active BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_catalog_history_listing_version UNIQUE (listing_id, listing_version),
    CHECK (listing_version >= 0),
    CHECK (new_mrp_paise >= 0),
    CHECK (new_selling_price_paise >= 0),
    CHECK (new_selling_price_paise <= new_mrp_paise),
    CHECK (CASE mutation_type
        WHEN 'CREATE' THEN TRUE
        WHEN 'UPDATE' THEN TRUE
        WHEN 'DEACTIVATE' THEN TRUE
        WHEN 'ACTIVATE' THEN TRUE
        ELSE FALSE
    END)
);

CREATE TABLE mypet.catalog_mutation_receipt (
    id UUID PRIMARY KEY,
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    mutation_type VARCHAR(24) NOT NULL,
    resulting_version BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_catalog_mutation_receipt_key UNIQUE (outlet_id, idempotency_key),
    CHECK (resulting_version >= 0),
    CHECK (CASE mutation_type
        WHEN 'UPDATE' THEN TRUE
        WHEN 'DEACTIVATE' THEN TRUE
        WHEN 'ACTIVATE' THEN TRUE
        ELSE FALSE
    END)
);

CREATE INDEX idx_catalog_listing_merchant_page
    ON mypet.catalog_listing (organization_id, outlet_id, active, updated_at, id);

CREATE INDEX idx_catalog_history_tenant_listing
    ON mypet.catalog_listing_history (organization_id, outlet_id, listing_id, listing_version);
