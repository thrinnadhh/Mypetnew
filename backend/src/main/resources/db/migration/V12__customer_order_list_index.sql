CREATE INDEX IF NOT EXISTS idx_product_order_customer_created_id
    ON mypet.product_order (customer_id, created_at DESC, id DESC);
