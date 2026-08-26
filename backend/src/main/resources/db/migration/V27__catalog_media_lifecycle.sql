CREATE TABLE mypet.catalog_media (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id) ON DELETE CASCADE,
    object_key VARCHAR(512) NOT NULL UNIQUE,
    public_url VARCHAR(2048) NOT NULL,
    content_type VARCHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum CHAR(64) NOT NULL,
    position INTEGER NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    listing_version BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_catalog_media_listing_position UNIQUE (listing_id, position),
    CONSTRAINT uq_catalog_media_listing_url UNIQUE (listing_id, public_url),
    CONSTRAINT uq_catalog_media_idempotency UNIQUE (outlet_id, idempotency_key),
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    CHECK (position >= 0 AND position < 5),
    CHECK (listing_version >= 0),
    CHECK (checksum ~ '^[0-9a-f]{64}$'),
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_catalog_media_tenant_listing
    ON mypet.catalog_media (organization_id, outlet_id, listing_id);
