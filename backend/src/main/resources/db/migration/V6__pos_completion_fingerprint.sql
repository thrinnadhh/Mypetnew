ALTER TABLE mypet.pos_sale
    ADD COLUMN request_fingerprint VARCHAR(64);

ALTER TABLE mypet.pos_sale
    ADD COLUMN loyalty_awarded BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mypet.pos_sale
    ADD COLUMN trace_id VARCHAR(64) NOT NULL DEFAULT 'legacy';

ALTER TABLE mypet.pos_sale
    ALTER COLUMN trace_id DROP DEFAULT;

CREATE INDEX idx_pos_sale_outlet_completed
    ON mypet.pos_sale (outlet_id, completed_at, id);
