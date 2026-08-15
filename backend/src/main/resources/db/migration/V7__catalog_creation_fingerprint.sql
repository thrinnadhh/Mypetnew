ALTER TABLE mypet.catalog_listing
    ADD COLUMN create_idempotency_key VARCHAR(128);

ALTER TABLE mypet.catalog_listing
    ADD COLUMN create_request_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX uq_catalog_listing_outlet_create_key
    ON mypet.catalog_listing (outlet_id, create_idempotency_key);

CREATE INDEX idx_catalog_listing_public_lookup
    ON mypet.catalog_listing (active, commerce_mode, outlet_id, id);
