ALTER TABLE mypet.product_order
    ADD COLUMN checkout_idempotency_key VARCHAR(128),
    ADD COLUMN checkout_request_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX uq_product_order_customer_checkout_key
    ON mypet.product_order (customer_id, checkout_idempotency_key)
    WHERE checkout_idempotency_key IS NOT NULL;

CREATE INDEX idx_product_order_outlet_status_created
    ON mypet.product_order (outlet_id, status, created_at, id);

CREATE INDEX idx_product_order_history_order_occurred
    ON mypet.product_order_history (order_id, occurred_at, id);
