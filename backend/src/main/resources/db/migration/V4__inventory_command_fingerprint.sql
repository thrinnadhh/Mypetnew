ALTER TABLE mypet.inventory_movement
    ADD COLUMN operation_scope VARCHAR(40) NOT NULL DEFAULT 'legacy',
    ADD COLUMN request_fingerprint VARCHAR(64) NOT NULL DEFAULT 'legacy';

ALTER TABLE mypet.inventory_movement
    ALTER COLUMN operation_scope DROP DEFAULT,
    ALTER COLUMN request_fingerprint DROP DEFAULT;

CREATE INDEX idx_inventory_movement_listing_occurred
    ON mypet.inventory_movement (listing_id, occurred_at, id);
